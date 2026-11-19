// Prueba del cerebro de la IA interna compilando el TS a JS en memoria.
// Usa el compilador de TypeScript instalado (igual que el build de Next) y
// stubs mínimos de navegador (localStorage, window, CustomEvent).
// Ejecutar: node scripts/test-ai.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- DOM mínimo ---
const storage = new Map();
global.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
  clear: () => storage.clear(),
};
const listeners = {};
global.CustomEvent = class { constructor(type, opts) { this.type = type; this.detail = opts?.detail; } };
const dispatch = (ev) => { for (const h of listeners[ev.type] ?? []) h(ev); };
global.window = {
  addEventListener: (t, h) => { (listeners[t] ??= []).push(h); },
  removeEventListener: () => {},
  dispatchEvent: dispatch,
  localStorage: global.localStorage,
  undefined,
};
global.document = { addEventListener: () => {} };

// --- compilar los 4 módulos implicados a JS común y requerirlos ---
const FILES = [
  "src/lib/time.ts",
  "src/lib/store.ts",
  "src/lib/engines/booking.ts",
  "src/lib/engines/assistant.ts",
];
const outDir = "/tmp/melo-ai-test";
const outputs = {};
for (const f of FILES) {
  const src = readFileSync(join(ROOT, f), "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
      esModuleInterop: true, jsx: ts.JsxEmit.Preserve,
    },
  }).outputText.replace(/^"use client";/m, "");
  outputs[f] = js;
}
// resolver los alias @/lib/* dentro del CommonJS generado
const moduleCache = {};
function req(path, from) {
  let f = path.startsWith("@/") ? "src/" + path.slice(2) : path;
  if (!f.endsWith(".ts")) f += ".ts";
  const key = f;
  if (moduleCache[key]) return moduleCache[key].exports;
  const mod = { exports: {} };
  moduleCache[key] = mod;
  const localReq = (p) => req(p, f);
  const fn = new Function("require", "module", "exports", outputs[f]);
  fn(localReq, mod, mod.exports);
  return mod.exports;
}

const { runAssistantCommand } = req("src/lib/engines/assistant.ts");
const store = req("src/lib/store.ts");
const booking = req("src/lib/engines/booking.ts");
const { todayKey, addDaysKey } = req("src/lib/time.ts");

// inicializar la BD (semilla) con horario de Ronald
store.getDB();

// fechas esperadas calculadas con las MISMAS utilidades de zona Bogotá del cerebro
const kHoy = todayKey();
const kManana = addDaysKey(kHoy, 1);
// "el 24": día 24 del mes en curso si no ha pasado, si no del siguiente (lógica del cerebro)
const [y, m] = kHoy.split("-").map(Number);
const dia24 = `${y}-${String(m).padStart(2, "0")}-24`;
const k24 = dia24 >= kHoy ? dia24 : (m === 12 ? `${y + 1}-01-24` : `${y}-${String(m + 1).padStart(2, "0")}-24`);
const k25 = (() => {
  const [y2, m2] = k24.split("-").map(Number);
  const dia25 = `${y2}-${String(m2).padStart(2, "0")}-25`;
  return dia25 >= kHoy ? dia25 : (m2 === 12 ? `${y2 + 1}-01-25` : `${y2}-${String(m2 + 1).padStart(2, "0")}-25`);
})();

const CASES = [
  // [descripción, frase, chequeos: función que devuelve true si el estado quedó bien]
  ["bloquear día 24 con motivo fumigación (la frase del dueño)", "bloquea la agenda el dia 24 que ese dia vamos a fumigar",
    () => store.getDB().blockedDates?.[k24] === "Fumigación"],
  ["bloquear día 25 por vacaciones (mal escrito)", "cerramos el 25 xq nos vamos de vacasiones",
    () => store.getDB().blockedDates?.[k25] === "Vacaciones"],
  ["bloquear mañana (relativa)", "manana no abrimos, fumigacion",
    () => store.getDB().blockedDates?.[kManana] === "Fumigación"],
  ["desbloquear el 24", "abre de nuevo el 24",
    () => !store.getDB().blockedDates?.[k24]],
  ["consultar días cerrados", "que dias hay cerrados?",
    () => true],
  ["verificar que el día bloqueado no da horas", "__slots__",
    () => booking.slotsForService(store.getDB(), store.getDB().services[0].id, kManana, "ANY").length === 0],
  ["cambiar frase del membrete", "cambia la frase del membrete a: Tu estilo, nuestra pasion",
    () => store.getAdminData().site.footerTagline === "Tu estilo, nuestra pasion"],
  ["cambiar whatsapp", "el whatsapp es 3211234567",
    () => store.getAdminData().site.footerWhatsapp === "573211234567"],
  ["precio con escritura rápida", "el corte clasico ahora vale 40 mil",
    () => store.getDB().services.find((s) => s.id === "svc-1").price === 40000],
  ["duración mal escrita", "la durason del corte clasico es 60 minutos",
    () => store.getDB().services.find((s) => s.id === "svc-1").durationMin === 60],
  ["crear servicio con k", "krear el servisio fade de 30 mil, 45 minutos",
    () => !!store.getDB().services.find((s) => s.name.toLowerCase() === "fade")],
  ["crear barbero", "crea el barbero luis",
    () => !!store.getDB().barbers.find((b) => b.name.toLowerCase() === "luis")],
  ["horario de barbero abreviado", "horario de ronald: lun a sab de 9 a 6",
    () => { const av = store.getDB().availability["b-ronald"]; return av.length === 6 && av[0].startTime === "09:00" && av[0].endTime === "18:00" && av[5].dayOfWeek === 6; }],
  ["intervalo entre cortes", "que las citas salgan cada 30 minutos",
    () => store.getBookingConfig().slotStepMin === 30],
  ["registrar gasto", "registra un gasto de 50 mil de insumos",
    () => store.getDB().expenses.some((e) => e.amount === 50000 && e.category === "INSUMOS")],
  ["consulta de agenda de mañana", "cuantas citas hay manana?",
    () => true],
  ["cancelar cita inexistente", "cancela la cita mb-xxxxxx",
    () => true],
  ["frase inentendible → pregunta útil", "asdfgh jkl",
    () => true],
  // ===== batería extendida: escritura desordenada y coloquial =====
  ["bloquear con día de semana", "no atendemos el proximo martes por mantenimiento",
    () => { const db = store.getDB(); return Object.entries(db.blockedDates ?? {}).some(([, v]) => v === "Mantenimiento"); }],
  ["bloquear fecha completa con año", "cerramos el 24 de diciembre de 2026 por festivo",
    () => store.getDB().blockedDates?.["2026-12-24"] === "Festivo"],
  ["bloquear con barra", "bloquea el 15/12",
    () => store.getDB().blockedDates?.["2026-12-15"] !== undefined],
  ["membrete con dos puntos", "membrete: la mejor de bogota",
    () => /la mejor de bogota/i.test(store.getAdminData().site.footerTagline)],
  ["precio con puntos de miles", "ponle el precio al fade en 25.000",
    () => { const s = store.getDB().services.find((x) => x.name.toLowerCase() === "fade"); return s?.price === 25000; }],
  ["precio con 40k", "el fade ahora cuesta 40k",
    () => { const s = store.getDB().services.find((x) => x.name.toLowerCase() === "fade"); return s?.price === 40000; }],
  ["desactivar barbero", "desactiva a luis",
    () => store.getDB().barbers.find((b) => b.name.toLowerCase() === "luis")?.active === false],
  ["activar barbero de nuevo", "activa a luis",
    () => store.getDB().barbers.find((b) => b.name.toLowerCase() === "luis")?.active === true],
  ["ayuda", "ayuda",
    () => true],
  ["saludo corto", "hola",
    () => true],
  // ===== bloquear un día que YA TIENE citas: se cancelan y se informa =====
  ["crear cita para probar cancelación", "__create_appt__",
    () => true],
  ["bloquear día con citas → cancela y avisa", "bloquea el dia de esa cita por emergencia",
    () => {
      const db = store.getDB();
      const appt = db.appointments.find((a) => a.clientName === "Cliente Bloqueo");
      return appt?.status === "CANCELLED" && /emergencia/i.test(appt.cancelReason ?? "");
    }],
];

let pass = 0, fail = 0;
// día destino para la cita de prueba: hoy+20, un día del mes que NINGÚN otro caso bloquea
const kCita = addDaysKey(kHoy, 20);
for (const [desc, frase, check] of CASES) {
  if (frase === "__create_appt__") {
    // crear cita manual para kCita a las 10:30 con ronald
    booking.createAppointment({
      barberId: "b-ronald", serviceId: store.getDB().services[0].id, dateKey: kCita,
      startMin: 10 * 60 + 30, clientName: "Cliente Bloqueo", origin: "MANUAL",
      createdByName: "test", allowPastToday: true,
    });
    const ok = store.getDB().appointments.some((a) => a.clientName === "Cliente Bloqueo");
    ok ? pass++ : fail++;
    console.log(`${ok ? "✓" : "✗ FALLO"} — ${desc} (${kCita} 10:30)`);
    continue;
  }
  if (desc === "bloquear día con citas → cancela y avisa") {
    const orden = `bloquea el ${Number(kCita.slice(8))} por emergencia`;
    const r = runAssistantCommand(orden);
    let ok;
    try { ok = check() && (r.text.includes("Cancelé") || r.text.includes("ya estaba cerrado")); } catch (e) { ok = false; }
    ok ? pass++ : fail++;
    console.log(`${ok ? "✓" : "✗ FALLO"} — ${desc} [orden: ${orden}]`);
    console.log(`    IA: ${r.text.split("\n").slice(0, 2).join(" | ").slice(0, 160)}`);
    continue;
  }
  if (frase === "__slots__") {
    const ok = check();
    ok ? pass++ : fail++;
    console.log(`${ok ? "✓" : "✗ FALLO"} — ${desc}`);
    continue;
  }
  let res;
  try {
    res = runAssistantCommand(frase);
  } catch (e) {
    console.log(`✗ EXCEPCIÓN — ${desc}: ${e.message}`);
    fail++;
    continue;
  }
  let ok;
  try { ok = check(); } catch (e) { ok = false; }
  ok ? pass++ : fail++;
  console.log(`${ok ? "✓" : "✗ FALLO"} — ${desc}`);
  console.log(`    IA: ${res.text.split("\n")[0].slice(0, 110)}${res.text.length > 110 ? "…" : ""}`);
}
console.log(`\n${pass} ✓ / ${fail} ✗ de ${CASES.length}`);
process.exit(fail > 0 ? 1 : 0);
