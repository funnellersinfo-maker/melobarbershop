"use client";
// ============================================================ SINCRONIZACIÓN MULTI-DISPOSITIVO
// Un único estado compartido para computador, celular y visitantes: cualquier
// cambio hecho en un dispositivo se refleja en la página principal de todos.
//
// Estrategia (sin servidor de aplicaciones, solo un DO en Cloudflare):
//  1. Cada escritura local (mutateDB / saveAdminData) marca la copia local como
//     "sucia" y programa un push (merge local → servidor).
//  2. Un poll cada 4 s pregunta al servidor por la revisión; si cambió, baja el
//     estado, lo mezcla con el local y refresca la UI ("melo:db-changed").
//  3. El merge nunca pierde datos: las colecciones operativas (citas, pagos,
//     comisiones, reseñas…) se unen por id con desempate por marca de tiempo;
//     el catálogo y el sitio público son un reemplazo por revisión (last-write-wins).
//  4. La revisión es un contador monotónico global generado en el cliente que
//     escribe (Date.now() garantiza orden entre sesiones de trabajo reales).

import { getDB, getAdminData, seedAdminData, sanitizeBookingConfig, DB_KEY, ADMIN_KEY } from "@/lib/store";
import type { AdminData, DB, Appointment, Payment, CommissionRule, Commission, Adjustment, Settlement, Expense, AuditLog, Notification, Post, Comment, Barber, Service, Availability } from "@/lib/store";

// Worker de sincronización (Cloudflare, plan gratuito).
const SYNC_URL = "https://melo-sync.mastershop-funnellers.workers.dev/state";
const SYNC_TOKEN = "melo-sync-v1-4f2b";
const POLL_MS = 4000;

// ============================ claves de mezcla por colección ============================
type CollKey =
  | "barbers" | "services" | "appointments" | "payments" | "commissionRules" | "commissions"
  | "adjustments" | "settlements" | "expenses" | "auditLogs" | "notifications" | "posts" | "comments";

const COLLECTIONS: Array<{ key: CollKey; union: boolean }> = [
  // union: mezclar por id (nunca perder una reserva hecha en otro dispositivo)
  { key: "appointments", union: true },
  { key: "payments", union: true },
  { key: "commissionRules", union: true },
  { key: "commissions", union: true },
  { key: "adjustments", union: true },
  { key: "settlements", union: true },
  { key: "expenses", union: true },
  { key: "auditLogs", union: true },
  { key: "notifications", union: true },
  { key: "posts", union: true },
  { key: "comments", union: true },
  // reemplazo: el dueño edita el catálogo/equipo en un solo lugar a la vez
  { key: "barbers", union: false },
  { key: "services", union: false },
];

function stampOf(o: { createdAt?: string | null; completedAt?: string | null; receivedAt?: string | null; validFrom?: string | null }): string {
  return String(o.createdAt ?? o.receivedAt ?? o.completedAt ?? o.validFrom ?? "");
}

function unionById<T extends { id: string }>(local: T[], remote: T[]): T[] {
  const map = new Map<string, T>();
  for (const r of remote) map.set(r.id, r);
  for (const l of local) {
    const r = map.get(l.id);
    if (!r || stampOf(l as never) >= stampOf(r as never)) map.set(l.id, l);
  }
  // conservar el orden de aparición (local primero, luego los remotos nuevos)
  const seen = new Set(local.map((x) => x.id));
  return [...local, ...Array.from(map.values()).filter((x) => !seen.has(x.id))];
}

function mergeAvailability(local: DB["availability"], remote: DB["availability"]): DB["availability"] {
  // por barbero: gana el que tenga más ventanas editadas recientemente no es
  // rastreable (las ventanas no llevan sello), así que gana la copia con el
  // último cambio conocido del barbero (ver mergeDB: se usa la revisión).
  const out: DB["availability"] = { ...remote };
  for (const [bid, wins] of Object.entries(local)) {
    const r = remote[bid];
    if (!r || r.length === 0) out[bid] = wins;
  }
  return out;
}

function mergeBarberServices(local: DB["barberServices"], remote: DB["barberServices"]): DB["barberServices"] {
  // unión de autorizaciones (que un barbero pueda atender un servicio nunca se
  // deshace solo por sincronizar) + limpiar pares huérfanos en el merge final
  return { ...remote, ...local };
}

function latestAdmin(local: AdminDataWithRev, remote: AdminDataWithRev): AdminData {
  return (local.__rev ?? 0) >= (remote.__rev ?? 0) ? local : remote;
}

// estado extendido con metadatos de revisión (no se persisten)
type AdminDataWithRev = AdminData & { __rev?: number };
type MergeSide = { db: DB; admin: AdminDataWithRev; __wins: boolean };

// ============================ estado del sincronizador ============================
let remoteRev = 0; // revisión del servidor conocida
let lastPushRev = 0; // revisión que este dispositivo subió por última vez
let dirty = false; // hay cambios locales sin subir
let booted = false; // ya bajó (o intentó bajar) el estado inicial: evita subir la semilla antes de mezclar
let lastPulledAdmin: AdminData | null = null; // admin tal como llegó del servidor (para detectar edición local)
let lastPulledDb: DB | null = null; // db tal como llegó del servidor
let pushing = false;
let started = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;

declare global {
  interface Window {
    __meloSyncStarted?: boolean;
  }
}

function refreshUI() {
  window.dispatchEvent(new CustomEvent("melo:db-changed", { detail: "sync" }));
  window.dispatchEvent(new CustomEvent("storage")); // refresca useMeloDB en todas las vistas
}

function writeLocal(db: DB | null, admin: AdminDataWithRev | null) {
  if (db) localStorage.setItem(DB_KEY, JSON.stringify(db));
  if (admin) {
    const { __rev, ...rest } = admin;
    void __rev;
    localStorage.setItem(ADMIN_KEY, JSON.stringify(rest));
  }
}

// ============================ merge principal ============================
/** Mezcla el estado local con el remoto y devuelve el estado combinado. */
export function mergeStates(local: MergeSide, remote: MergeSide) {
  const db: DB = { ...remote.db } as DB;
  for (const { key, union } of COLLECTIONS) {
    const l = local.db[key] as { id: string }[];
    const r = remote.db[key] as { id: string }[];
    db[key] = (union ? unionById(l, r) : local.__wins ? l : r) as never;
  }
  db.availability = local.__wins ? { ...remote.db.availability, ...local.db.availability } : remote.db.availability;
  db.barberServices = mergeBarberServices(local.db.barberServices, remote.db.barberServices);
  const admin = latestAdmin(local.admin, remote.admin);
  return { db, admin };
}

// ============================ ciclo pull / push ============================
async function pull(): Promise<boolean> {
  let res: Response;
  try {
    res = await fetch(`${SYNC_URL}?rev=${remoteRev}`, { headers: { "x-melo-sync": SYNC_TOKEN } });
  } catch {
    return false; // sin conexión: seguimos con el estado local
  }
  if (!res.ok) return false;
  let body: { rev?: number; same?: boolean; payload?: { db?: DB; admin?: AdminData } | null };
  try {
    body = await res.json();
  } catch {
    return false;
  }
  const rev = Number(body.rev || 0);
  booted = true; // ya hablamos con el servidor: se puede subir con seguridad
  if (!rev || !body.payload || !body.payload.db) {
    // servidor vacío (primera vez en la historia): subir nuestro estado completo
    remoteRev = rev;
    dirty = true;
    schedulePush(0);
    return false;
  }
  if (body.same || rev === remoteRev) return false;
  try {
  const remoteDb = body.payload.db;
  const remoteAdmin: AdminDataWithRev = { ...(body.payload.admin ?? seedAdminData()), __rev: rev };
  // ¿este dispositivo editó el catálogo/equipo/sitio desde el último pull?
  // (comparación por contenido: detecta también ediciones hechas sin conexión)
  const localDb = getDB();
  const localAdmin = getAdminData();
  const dbChangedLocally =
    !!lastPulledDb &&
    (JSON.stringify(localDb.barbers) !== JSON.stringify(lastPulledDb.barbers) ||
      JSON.stringify(localDb.services) !== JSON.stringify(lastPulledDb.services) ||
      JSON.stringify(localDb.availability) !== JSON.stringify(lastPulledDb.availability) ||
      JSON.stringify(localDb.barberServices) !== JSON.stringify(lastPulledDb.barberServices));
  const adminChangedLocally =
    !!lastPulledAdmin && JSON.stringify(localAdmin) !== JSON.stringify(lastPulledAdmin);
  const localWinsCatalog = dirty || dbChangedLocally; // hay edición local no publicada aún

  const { db, admin } = mergeStates(
    {
      db: localDb,
      admin: { ...localAdmin, __rev: adminChangedLocally ? rev + 1 : lastPushRev },
      __wins: localWinsCatalog,
    },
    { db: remoteDb, admin: remoteAdmin, __wins: false },
  );

  // limpiar autorizaciones huérfanas (barbero o servicio eliminado en otro lado)
  const keep = new Set<string>();
  for (const b of db.barbers) for (const s of db.services) keep.add(`${b.id}:${s.id}`);
  db.barberServices = Object.fromEntries(Object.entries(db.barberServices).filter(([k]) => keep.has(k)));

  remoteRev = rev;
  {
    // guardar la referencia del servidor SIN __rev (igual a como se persiste),
    // para que la comparación del siguiente pull detecte solo cambios reales
    const { __rev: _rev, ...adminNoRev } = admin as AdminDataWithRev;
    void _rev;
    lastPulledAdmin = JSON.parse(JSON.stringify(adminNoRev)) as AdminData;
    lastPulledDb = JSON.parse(JSON.stringify(db)) as DB;
  }
  writeLocal(db, admin);
  // invalidar cachés del store y refrescar toda la UI al instante
  window.dispatchEvent(new CustomEvent("melo:invalidate-cache"));
  refreshUI();
  return true;
  } catch (e) {
    // estado remoto corrupto o inesperado: ignorar este pull y seguir con el local
    console.error("[melo-sync] pull falló", e);
    return false;
  }
}

async function push() {
  if (pushing) return;
  pushing = true;
  try {
    // ¿el servidor tiene una revisión que este dispositivo aún no ha bajado?
    // (otro dispositivo subió algo después de nuestro último pull) → mezclar antes de subir
    try {
      const probe = await fetch(`${SYNC_URL}?rev=${remoteRev}`, { headers: { "x-melo-sync": SYNC_TOKEN } });
      if (probe.ok) {
        const body = (await probe.json()) as { rev?: number; same?: boolean };
        if (!body.same && Number(body.rev || 0) > remoteRev) {
          await pull(); // baja y mezcla el estado nuevo antes de pisarlo
        }
      }
    } catch {
      /* sin conexión al sondear: intentar el PUT igualmente */
    }
    // revisión monotónica global: nunca menor que la del servidor ni que la
    // última subida (por si el reloj del dispositivo está atrasado/adelantado)
    const rev = Math.max(Date.now(), remoteRev + 1, lastPushRev + 1);
    const payload = { db: getDB(), admin: getAdminData() };
    if (typeof window !== "undefined") {
      (window as unknown as { __meloSync?: unknown }).__meloSync = {
        phase: "push", rev, tagline: (payload.admin as AdminData).site.footerTagline.slice(0, 40),
        dirty, booted, remoteRev, lastPushRev,
      };
    }
    const res = await fetch(SYNC_URL, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-melo-sync": SYNC_TOKEN },
      body: JSON.stringify({ rev, payload }),
    });
    if (res.ok) {
      remoteRev = rev;
      lastPushRev = rev;
      dirty = false;
      if (typeof window !== "undefined") {
        (window as unknown as { __meloSync?: unknown }).__meloSync = { phase: "push-ok", rev, dirty: false };
      }
    } else if (res.status === 409) {
      // el servidor tiene una revisión mayor: bajarla y reintentar con merge
      lastPushRev = 0;
      await pull();
      if (dirty) await push(); // una sola reintentada para no entrar en bucle
    }
  } catch {
    // sin conexión: el próximo cambio o el poll lo reintenta
  } finally {
    pushing = false;
  }
}

function schedulePush(delayMs = 700) {
  dirty = true;
  if (!booted) return; // aún no baja el estado inicial: el push se dispara al terminar el arranque
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void push();
  }, delayMs);
}

// ============================ API pública ============================
/** Marca que hay cambios locales (lo llama mutateDB / saveAdminData). */
export function notifyLocalChange() {
  if (!started) return;
  schedulePush();
}

/** Arranca la sincronización (una sola vez por pestaña). */
export function startSync() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.__meloSyncStarted = true;
  void pull().finally(() => {
    // si hubo cambios locales mientras arrancaba (o el servidor estaba vacío), subirlos ya
    if (dirty) schedulePush(0);
  });
  pollTimer = setInterval(() => {
    if (!pushing) void pull();
  }, POLL_MS);
  // al volver la conexión tras estar sin internet, sincronizar de inmediato
  window.addEventListener("online", () => {
    void pull();
    if (dirty) schedulePush(0);
  });
  // refrescar cuando la pestaña vuelve a primer plano (celular en segundo plano)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void pull();
  });
}

export function stopSync() {
  started = false;
  if (pollTimer) clearInterval(pollTimer);
  if (pushTimer) clearTimeout(pushTimer);
  pollTimer = null;
  pushTimer = null;
}
