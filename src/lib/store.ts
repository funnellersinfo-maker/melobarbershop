"use client";
// MELO BARBERSHOP — capa de datos en el navegador (sustituye al backend).
// Todo persiste en localStorage; un JSON completo por clave "melo.db.v1".
// Persistencia del admin: "melo.adminData.v1" (sitio, notificaciones, extras).

export const DB_KEY = "melo.db.v1";
export const ADMIN_KEY = "melo.adminData.v1";
export const SESSION_KEY = "melo.session.v1";

export const OWNER_KEY = "PACO2027";

// ============================================================ TIPOS
export type Role = "OWNER" | "BARBER";

export type Barber = {
  id: string;
  name: string;
  bio: string; // reseña corta
  photo: string | null; // dataURL
  code: string; // código único de acceso (contraseña del barbero)
  active: boolean;
  phone: string | null;
  specialty: string;
  permissions: Record<string, boolean>;
  createdAt: string;
};

export type Service = {
  id: string;
  name: string;
  description: string;
  price: number;
  durationMin: number;
  active: boolean;
  sortOrder: number;
};

export type Availability = { dayOfWeek: number; startTime: string; endTime: string; active: boolean };

export type AppointmentStatus = "RESERVED" | "CONFIRMED" | "IN_ATTENTION" | "COMPLETED" | "CANCELLED" | "NO_SHOW";

export type Appointment = {
  id: string;
  code: string;
  barberId: string;
  serviceId: string;
  origin: "PUBLIC" | "MANUAL";
  status: AppointmentStatus;
  clientName: string;
  clientPhone: string | null;
  startTime: string; // ISO UTC
  endTime: string;
  priceSnapshot: number;
  discount: number;
  notes: string | null;
  cancelReason: string | null;
  completedAt: string | null;
  createdAt: string;
};

export type Payment = {
  id: string;
  appointmentId: string;
  amount: number;
  method: "CASH" | "TRANSFER" | "CARD" | "OTHER";
  status: "CONFIRMED" | "PARTIALLY_REFUNDED" | "REFUNDED";
  refundedAmount: number;
  externalRef: string | null;
  notes: string | null;
  refundReason: string | null;
  receivedAt: string;
  registeredById: string;
  registeredByName: string;
};

export type CommissionRule = {
  id: string;
  barberId: string;
  serviceId: string | null; // null = regla por defecto del barbero
  commissionType: "PERCENT" | "FIXED" | "MIXED";
  percent: number | null;
  fixedAmount: number | null;
  validFrom: string;
  validTo: string | null;
  note: string | null;
};

export type Commission = {
  id: string;
  appointmentId: string;
  barberId: string;
  status: "PENDING_CONFIG" | "PENDING_PAYMENT" | "PAID";
  configured: boolean;
  commissionType: "PERCENT" | "FIXED" | "MIXED" | null;
  percent: number | null;
  fixedAmount: number | null;
  baseAmount: number;
  calculatedAmount: number;
  manualSet: boolean;
  manualReason: string | null;
  snapshot: CommissionSnapshot;
  createdAt: string;
};

export type CommissionSnapshot = {
  serviceName: string;
  servicePrice: number;
  appointmentPrice: number;
  discount: number;
  base: number;
  ruleLabel: string;
  ruleSource: "SPECIFIC" | "BARBER_DEFAULT" | "NONE";
  completedAt: string;
};

export type Adjustment = {
  id: string;
  barberId: string;
  type: "ADVANCE" | "REFUND" | "MANUAL";
  amount: number; // con signo
  reason: string;
  status: "PENDING" | "SETTLED";
  createdByName: string;
  createdAt: string;
};

export type SettlementItem = {
  id: string;
  itemType: "COMMISSION" | "ADVANCE" | "REFUND" | "MANUAL";
  label: string;
  amount: number;
  commissionId: string | null;
  adjustmentId: string | null;
};

export type Settlement = {
  id: string;
  code: string;
  barberId: string;
  status: "DRAFT" | "APPROVED" | "PAID";
  notes: string | null;
  totalCommissions: number;
  totalAdjustments: number;
  totalAmount: number;
  approvedByName: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  paymentMethod: string | null;
  createdAt: string;
  items: SettlementItem[];
};

export type Expense = {
  id: string;
  description: string;
  category: "ALQUILER" | "INSUMOS" | "SERVICIOS" | "MANTENIMIENTO" | "NOMINA_EXTRA" | "OTROS";
  amount: number;
  method: string | null;
  notes: string | null;
  spentAt: string;
  createdByName: string;
};

export type AuditLog = {
  id: string;
  entity: string;
  entityId: string;
  action: string;
  before: unknown;
  after: unknown;
  userName: string;
  createdAt: string;
};

export type Notification = {
  id: string;
  type: string;
  title: string;
  message: string;
  userId: string; // "OWNER" o barberId
  read: boolean;
  createdAt: string;
};

export type PostMedia = { type: "IMAGE" | "VIDEO"; src: string; };

export type Post = {
  id: string;
  barberId: string;
  caption: string;
  media: PostMedia[];
  likes: string[]; // deviceIds que dieron like
  createdAt: string;
  hidden?: boolean;
};

export type Comment = {
  id: string;
  postId: string | null; // comentario en post (null = reseña directa del barbero)
  barberId: string; // barbero reseñado (para reseñas)
  authorName: string;
  deviceId: string;
  rating: number | null; // 1-5 solo para reseñas
  text: string;
  createdAt: string;
  hidden?: boolean;
};

// ============================================================ DB PRINCIPAL
export type DB = {
  version: number;
  barbers: Barber[];
  services: Service[];
  availability: Record<string, Availability[]>;
  barberServices: Record<string, boolean>; // `${barberId}:${serviceId}` -> autorizado
  appointments: Appointment[];
  payments: Payment[];
  commissionRules: CommissionRule[];
  commissions: Commission[];
  adjustments: Adjustment[];
  settlements: Settlement[];
  expenses: Expense[];
  auditLogs: AuditLog[];
  notifications: Notification[];
  posts: Post[];
  comments: Comment[];
};

export const DEVICE_ID_KEY = "melo.deviceId.v1";
export function deviceId(): string {
  if (typeof window === "undefined") return "server";
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

// ---------- utilidades ----------
export function cuid(prefix = "id"): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function appointmentCode(): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return `MB-${s}`;
}

export function uniqueCode(existing: Set<string>): string {
  for (let i = 0; i < 20; i++) {
    const c = appointmentCode();
    if (!existing.has(c)) return c;
  }
  return `MB-${Date.now().toString(36).toUpperCase()}`;
}

export function barberAccessCode(name: string): string {
  // Código legible y único basado en el nombre + aleatorio
  const base = name.toUpperCase().normalize("NFD").replace(/[^A-Z0-9]/g, "").slice(0, 4) || "BRB";
  return `${base}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

// ============================================================ SEED
function seedAvailability(): Record<string, Availability[]> {
  const av: Record<string, Availability[]> = {};
  const windows: Availability[] = [];
  for (let day = 2; day <= 6; day++) {
    windows.push({ dayOfWeek: day, startTime: "10:00", endTime: "13:00", active: true });
    windows.push({ dayOfWeek: day, startTime: "14:00", endTime: "19:00", active: true });
  }
  for (const id of ["b1", "b2", "b3"]) av[id] = windows.map((w) => ({ ...w }));
  return av;
}

export function seedDB(): DB {
  const services: Service[] = [
    { id: "svc-1", name: "Corte Clásico", description: "Corte a tijera y máquina, acabado con toalla caliente.", price: 35000, durationMin: 45, active: true, sortOrder: 1 },
    { id: "svc-2", name: "Corte + Barba", description: "Corte completo más arreglo de barba con navaja.", price: 50000, durationMin: 60, active: true, sortOrder: 2 },
    { id: "svc-3", name: "Arreglo de Barba", description: "Perfilado, rasurado y aceites.", price: 20000, durationMin: 25, active: true, sortOrder: 3 },
    { id: "svc-4", name: "Diseño y Afinado", description: "Líneas, diseño personalizado y acabado.", price: 18000, durationMin: 20, active: true, sortOrder: 4 },
    { id: "svc-5", name: "Lavado Capilar", description: "Lavado con masaje y secado.", price: 15000, durationMin: 20, active: true, sortOrder: 5 },
    { id: "svc-6", name: "Corte Infantil", description: "Corte para menores, incluye acabado.", price: 25000, durationMin: 35, active: true, sortOrder: 6 },
  ];
  const barbers: Barber[] = [
    { id: "b1", name: "Santiago Ruiz", bio: "Especialista en cortes clásicos y navaja. 8 años de experiencia.", photo: null, code: "SGO-7K2M", active: true, phone: "+573011111111", specialty: "Corte clásico", permissions: {}, createdAt: new Date().toISOString() },
    { id: "b2", name: "Andrés Gómez", bio: "Diseños, líneas y fades de precisión.", photo: null, code: "AGO-9X4P", active: true, phone: "+573012222222", specialty: "Diseño y fades", permissions: {}, createdAt: new Date().toISOString() },
    { id: "b3", name: "Camilo Torres", bio: "Barba, toalla caliente y atención relajante.", photo: null, code: "CTO-3B8R", active: true, phone: "+573013333333", specialty: "Barba y acabados", permissions: {}, createdAt: new Date().toISOString() },
  ];
  const barberServices: Record<string, boolean> = {};
  for (const b of barbers) for (const s of services) barberServices[`${b.id}:${s.id}`] = true;

  return {
    version: 1,
    barbers,
    services,
    availability: seedAvailability(),
    barberServices,
    appointments: [],
    payments: [],
    commissionRules: [],
    commissions: [],
    adjustments: [],
    settlements: [],
    expenses: [],
    auditLogs: [],
    notifications: [],
    posts: [],
    comments: [],
  };
}

// ============================================================ ADMIN DATA (sitio editable)
export type HeroMediaItem = {
  id: string;
  type: "IMAGE" | "VIDEO" | "CAROUSEL";
  src: string;
  src2?: string; // segunda pieza del carrusel
  src3?: string;
};

export type SiteConfig = {
  // HERO
  heroTitle: string;
  heroTitleAccent: string;
  heroSubtitle: string;
  heroBadge: string;
  heroPrimaryCta: string;
  heroSecondaryCta: string;
  heroMediaMode: "LOGO" | "IMAGE" | "VIDEO" | "CAROUSEL";
  heroMedia: HeroMediaItem[];
  heroSchedule: string[]; // líneas de horario que se muestran en el hero
  // Secciones
  servicesTitle: string;
  servicesSubtitle: string;
  teamTitle: string;
  teamSubtitle: string;
  bookingTitle: string;
  bookingSubtitle: string;
  faqTitle: string;
  faqSubtitle: string;
  faq: Array<{ q: string; a: string }>;
  showTeamSection: boolean;
  showFaqSection: boolean;
  showServicesSection: boolean;
  showBookingSection: boolean;
  showSocialHero: boolean; // perfiles tipo red social en el hero (opcional)
  // Footer / membrete
  businessName: string;
  footerTagline: string;
  footerPhone: string;
  footerAddress: string;
  footerEmail: string;
  footerWhatsapp: string; // número WhatsApp del negocio (reservas)
  footerHours: string[];
  socialInstagram: string;
  socialFacebook: string;
  socialTiktok: string;
};

export type NotifConfig = {
  sound: "ding" | "chime" | "bell" | "pulse" | "none";
  vibrate: boolean;
  insistSeconds: number; // cada cuántos segundos repetir la solicitud de permiso
  notifyOnBooking: boolean;
  notifyOnCancel: boolean;
  notifyOnPayment: boolean;
  notifyOnComplete: boolean;
};

export type AdminData = {
  version: number;
  site: SiteConfig;
  notif: NotifConfig;
  profile: OwnerProfile;
};

// ============================================================ PERFIL DEL PROPIETARIO (premium "Ronald")
export type OwnerProfile = {
  name: string; // nombre del administrador (se muestra en el panel)
  manualXP: boolean; // premium: controlar el XP manualmente
  xpOverride: number; // valor manual del XP
  levelOverride: string | null; // premium: rango fijo ("Aprendiz"…"Leyenda") o null = automático
};

/** Nombre que activa el premium del administrador. */
export const PREMIUM_OWNER_NAME = "ronald";

export function seedOwnerProfile(): OwnerProfile {
  return { name: "Propietario", manualXP: false, xpOverride: 0, levelOverride: null };
}

/** El premium solo existe para el administrador cuyo nombre sea exactamente "Ronald". */
export function isOwnerPremium(p: OwnerProfile): boolean {
  return p.name.trim().toLowerCase() === PREMIUM_OWNER_NAME;
}

/** XP automático del propietario: servicios completados en toda la barbería. */
export function ownerAutoXP(db: DB): number {
  return db.appointments.filter((a) => a.status === "COMPLETED").length;
}

export function seedAdminData(): AdminData {
  return {
    version: 1,
    site: {
      heroTitle: "Más que un corte,",
      heroTitleAccent: "una experiencia…",
      heroSubtitle: "Reserva en línea con el barbero de tu preferencia. Sin filas, sin llamadas: elige el servicio, la hora y nosotros nos encargamos del resto.",
      heroBadge: "Estética y barbería clásica",
      heroPrimaryCta: "Reservar ahora",
      heroSecondaryCta: "Ver servicios y precios",
      heroMediaMode: "LOGO",
      heroMedia: [],
      heroSchedule: ["Mar–Sáb · 10:00–13:00 y 14:00–19:00", "Dom y Lun: cerrado"],
      servicesTitle: "Servicios",
      servicesSubtitle: "Elige tu servicio; los precios los administra la barbería.",
      teamTitle: "Nuestro equipo",
      teamSubtitle: "Elige con quién quieres tu experiencia. O deja que el sistema asigne el barbero disponible.",
      bookingTitle: "Reserva tu cita",
      bookingSubtitle: "Al confirmar, tu resumen llega directo a nuestro WhatsApp y te respondemos para dejarla agendada.",
      faqTitle: "Preguntas frecuentes",
      faqSubtitle: "Todo lo que suelen preguntarnos antes de reservar.",
      faq: [
        { q: "¿Cómo reservo mi cita?", a: "Elige el servicio, el barbero (o «cualquiera»), el día y la hora. Al confirmar se abre WhatsApp con tu resumen listo para enviar: al recibirlo confirmamos tu cita." },
        { q: "¿Necesito pagar por adelantado?", a: "No. El pago se realiza en la barbería al terminar el servicio, en efectivo o transferencia." },
        { q: "¿Puedo cambiar o cancelar mi cita?", a: "Sí. Escríbenos por WhatsApp con tu código de cita y la reprogramamos o cancelamos sin costo." },
        { q: "¿Qué pasa si llego tarde?", a: "Tenemos 10 minutos de cortesía. Después el cupo puede pasar a otro cliente, así que avísanos si vas demorado." },
        { q: "¿Atienden niños?", a: "Claro, tenemos corte infantil. Los menores deben venir acompañados por un adulto." },
      ],
      showTeamSection: true,
      showFaqSection: true,
      showServicesSection: true,
      showBookingSection: true,
      showSocialHero: false,
      businessName: "MELO BARBERSHOP",
      footerTagline: "Más que un corte, una experiencia. Barbería clásica con estándar moderno.",
      footerPhone: "+57 321 367 2594",
      footerAddress: "Calle de la Barbería, Bogotá",
      footerEmail: "",
      footerWhatsapp: "573213672594",
      footerHours: ["Martes a sábado", "10:00–13:00 · 14:00–19:00", "Domingo y lunes: cerrado"],
      socialInstagram: "",
      socialFacebook: "",
      socialTiktok: "",
    },
    notif: {
      sound: "ding",
      vibrate: true,
      insistSeconds: 25,
      notifyOnBooking: true,
      notifyOnCancel: true,
      notifyOnPayment: true,
      notifyOnComplete: true,
    },
    profile: seedOwnerProfile(),
  };
}

// ============================================================ LECTURA / ESCRITURA
function readJSON<T>(key: string, fallback: () => T): T {
  if (typeof window === "undefined") return fallback();
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback();
    return JSON.parse(raw) as T;
  } catch {
    return fallback();
  }
}

function writeJSON(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent("melo:db-changed", { detail: key }));
  } catch (e) {
    console.error("[melo] no se pudo guardar", key, e);
  }
}

let memDb: DB | null = null;
let memAdmin: AdminData | null = null;

export function getDB(): DB {
  if (!memDb) {
    memDb = readJSON<DB>(DB_KEY, seedDB);
    writeJSON(DB_KEY, memDb); // persistir seed de inmediato
  }
  return memDb;
}

export function getAdminData(): AdminData {
  if (!memAdmin) {
    const fallback = () => {
      const stored = (() => {
        try {
          if (typeof window === "undefined") return null;
          const raw = localStorage.getItem(ADMIN_KEY);
          return raw ? (JSON.parse(raw) as AdminData) : null;
        } catch {
          return null;
        }
      })();
      if (!stored) return seedAdminData();
      // migración: rellenar campos nuevos con valores por defecto
      const base = seedAdminData();
      return {
        ...stored,
        version: base.version,
        site: { ...base.site, ...stored.site },
        notif: { ...base.notif, ...stored.notif },
        profile: { ...base.profile, ...(stored.profile ?? {}) },
      };
    };
    memAdmin = fallback();
    writeJSON(ADMIN_KEY, memAdmin);
  }
  return memAdmin;
}

export function saveDB(db: DB) {
  memDb = db;
  writeJSON(DB_KEY, db);
}

export function mutateDB(fn: (db: DB) => void): DB {
  const db = getDB();
  fn(db);
  saveDB(db);
  return db;
}

export function saveAdminData(data: AdminData) {
  memAdmin = data;
  writeJSON(ADMIN_KEY, data);
}

export function resetAll() {
  memDb = null;
  memAdmin = null;
  if (typeof window !== "undefined") {
    localStorage.removeItem(DB_KEY);
    localStorage.removeItem(ADMIN_KEY);
    localStorage.removeItem(SESSION_KEY);
  }
}

// ============================================================ AUDITORÍA + NOTIFICACIONES
export function audit(entity: string, entityId: string, action: string, userName: string, before?: unknown, after?: unknown) {
  mutateDB((db) => {
    db.auditLogs.unshift({
      id: cuid("aud"),
      entity,
      entityId,
      action,
      before: before === undefined ? null : before,
      after: after === undefined ? null : after,
      userName,
      createdAt: new Date().toISOString(),
    });
    if (db.auditLogs.length > 800) db.auditLogs.length = 800;
  });
}

export function pushNotification(
  userId: string,
  type: string,
  title: string,
  message: string
) {
  mutateDB((db) => {
    db.notifications.unshift({
      id: cuid("ntf"),
      type,
      title,
      message,
      userId,
      read: false,
      createdAt: new Date().toISOString(),
    });
    if (db.notifications.length > 400) db.notifications.length = 400;
  });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("melo:notification", { detail: { userId, type, title, message } }));
  }
}

// ============================================================ SESIÓN
export type SessionUser =
  | { role: "OWNER"; id: "OWNER"; name: string }
  | { role: "BARBER"; id: string; name: string };

export function getSession(): SessionUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    return null;
  }
}

export function setSession(s: SessionUser | null) {
  if (typeof window === "undefined") return;
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else localStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new CustomEvent("melo:session"));
}

/** Login unificado: la clave del propietario o el código único de un barbero. */
export function loginWithCode(code: string): SessionUser | null {
  const c = code.trim().toUpperCase();
  if (!c) return null;
  if (c === OWNER_KEY) {
    const s: SessionUser = { role: "OWNER", id: "OWNER", name: "Propietario" };
    setSession(s);
    return s;
  }
  const db = getDB();
  const barber = db.barbers.find((b) => b.code.toUpperCase() === c);
  if (barber && barber.active) {
    const s: SessionUser = { role: "BARBER", id: barber.id, name: barber.name };
    setSession(s);
    return s;
  }
  return null;
}

export function logout() {
  setSession(null);
}
