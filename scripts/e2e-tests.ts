// MELO BARBERSHOP — Validación real de los 10 escenarios del requisito H.
// Ejecución contra el sistema en marcha (http://localhost:3000):
//   bun scripts/e2e-tests.ts smoke    # humo rápido: catálogo + login
//   bun scripts/e2e-tests.ts phaseA   # H.1–H.9 + H.10 sin WhatsApp configurado
//   bun scripts/e2e-tests.ts phaseB   # H.10 con proveedor simulado (requiere .env con mock y servidor reiniciado)
//   bun scripts/e2e-tests.ts all      # fase A + activa mock, reinicia, fase B, restaura .env y reinicia
import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
type Json = Record<string, any>;

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed++;
    failures.push(name + (detail ? ` — ${detail}` : ""));
    console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function req(cookie: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* respuesta vacía */
  }
  return { status: res.status, json, cookie: res.headers.get("set-cookie") };
}

async function login(email: string): Promise<string> {
  const r = await req(null, "POST", "/api/auth/login", { email, password: "melo1234" });
  if (r.status !== 200) throw new Error(`login falló para ${email}: HTTP ${r.status} ${JSON.stringify(r.json)}`);
  return (r.cookie ?? "").split(";")[0];
}

// ---------- fechas (Bogotá UTC-5, sin DST) ----------
const OFFSET = 5 * 3600 * 1000;
function todayKey(): string {
  return new Date(Date.now() - OFFSET).toISOString().slice(0, 10);
}
function addDays(key: string, n: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dow(key: string): number {
  return new Date(`${key}T12:00:00Z`).getUTCDay();
}
/** Primer día hábil (martes–sábado) al menos `minAhead` días en el futuro. */
function nextWorkingDay(minAhead: number): string {
  const t = todayKey();
  for (let i = minAhead; i < minAhead + 21; i++) {
    const k = addDays(t, i);
    if (dow(k) >= 2 && dow(k) <= 6) return k;
  }
  throw new Error("no se encontró día hábil");
}
const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const toHM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

async function firstSlot(serviceId: string, date: string, barberId: string): Promise<{ time: string; barbers: string[] }> {
  const r = await req(null, "GET", `/api/public/slots?serviceId=${serviceId}&date=${date}&barberId=${barberId}`);
  if (r.status !== 200) throw new Error(`slots falló: ${r.status} ${JSON.stringify(r.json)}`);
  const slots = r.json.slots as Array<{ time: string; barbers: string[] }>;
  if (!slots?.length) throw new Error("sin horarios disponibles para la prueba");
  return slots[0];
}

async function publicBook(payload: Json) {
  return req(null, "POST", "/api/public/book", payload);
}

// ================================================================ FASE A
async function phaseA() {
  console.log("\n════════ FASE A · Escenarios H.1–H.9 + H.10 sin WhatsApp configurado ════════");
  const owner = await login("owner@melo.com");
  const santiago = await login("santiago@melo.com");
  const camilo = await login("camilo@melo.com");

  const cat = (await req(null, "GET", "/api/public/catalog")).json;
  const barbers: Json[] = cat.barbers;
  const services: Json[] = cat.services;
  const san = barbers.find((b: Json) => b.name.includes("Santiago"));
  const cam = barbers.find((b: Json) => b.name.includes("Camilo"));
  if (!san || !cam) throw new Error("no se encontraron los barberos del seed");
  const svc1 = services[0]; // Corte Clásico (45 min)
  const svc2 = services[1]; // Corte + Barba (60 min)
  console.log(`  Servicios: ${svc1.name} (${svc1.durationMin} min) · ${svc2.name} (${svc2.durationMin} min)`);

  const D = nextWorkingDay(3);
  console.log(`  Fecha de pruebas (Bogotá): ${D}`);

  // ---------------- H.1 ----------------
  console.log("\n[H.1] Una reserva pública aparece en el calendario");
  const slot1 = await firstSlot(svc1.id, D, "ANY");
  const book1 = await publicBook({
    serviceId: svc1.id,
    date: D,
    time: slot1.time,
    barberId: "ANY",
    clientName: "Hugo Prueba H1",
    clientPhone: "+573001110001",
  });
  check("reserva pública creada (HTTP 201)", book1.status === 201, `código ${book1.json?.appointment?.code ?? "?"}`);
  const code1: string = book1.json?.appointment?.code;
  const cal1 = (await req(owner, "GET", `/api/appointments?date=${D}`)).json;
  const appt1 = (cal1.appointments ?? []).find((a: Json) => a.code === code1);
  check("visible en el calendario interno (GET /api/appointments?date=…)", !!appt1);
  check("origen registrado como PUBLIC", appt1?.origin === "PUBLIC");
  check("estado inicial RESERVED", appt1?.status === "RESERVED");
  const barber1Id: string = appt1?.barber?.id ?? slot1.barbers[0];
  const calBarber = (await req(santiago, "GET", `/api/appointments?date=${D}`)).json;
  check("la agenda del barbero consulta el mismo día sin error", Array.isArray(calBarber.appointments));

  // ---------------- H.2 ----------------
  console.log("\n[H.2] Una cita manual respeta la disponibilidad");
  let sunday = D;
  while (dow(sunday) !== 0) sunday = addDays(sunday, 1);
  const badSun = await req(owner, "POST", "/api/appointments", {
    barberId: cam.id, serviceId: svc1.id, date: sunday, time: "10:00", clientName: "Domingo Invalido",
  });
  check("domingo (sin ventanas del barbero) rechazada con 400", badSun.status === 400 && /disponibilidad/i.test(badSun.json?.error ?? ""), badSun.json?.error);
  const badHour = await req(owner, "POST", "/api/appointments", {
    barberId: cam.id, serviceId: svc1.id, date: D, time: "13:30", clientName: "Hora Invalida",
  });
  check("13:30 (hueco entre ventanas 10–13 y 14–19) rechazada con 400", badHour.status === 400 && /disponibilidad/i.test(badHour.json?.error ?? ""), badHour.json?.error);
  const badPast = await req(owner, "POST", "/api/appointments", {
    barberId: cam.id, serviceId: svc1.id, date: addDays(todayKey(), -7), time: "10:00", clientName: "Semana Pasada",
  });
  check("fecha pasada rechazada con 400", badPast.status === 400, badPast.json?.error);
  const slotCam = await firstSlot(svc2.id, D, cam.id);
  const okManual = await req(owner, "POST", "/api/appointments", {
    barberId: cam.id, serviceId: svc2.id, date: D, time: slotCam.time, clientName: "Manual Valida H2", clientPhone: "+573001110002",
  });
  check("cita manual válida (dentro de ventana) creada con 201", okManual.status === 201, `código ${okManual.json?.appointment?.code}`);
  const manualCamId: string = okManual.json?.appointment?.id;

  // ---------------- H.3 ----------------
  console.log("\n[H.3] El mismo horario no puede reservarse dos veces");
  const camStart = toMin(slotCam.time);
  const dupPublic = await publicBook({
    serviceId: svc1.id, date: D, time: toHM(camStart + 15), barberId: cam.id, clientName: "Solape Publico",
  });
  check("reserva pública solapada con cita manual → 409", dupPublic.status === 409 && /cruza/i.test(dupPublic.json?.error ?? ""), dupPublic.json?.error);
  const dupManual = await req(owner, "POST", "/api/appointments", {
    barberId: cam.id, serviceId: svc1.id, date: D, time: toHM(camStart + 30), clientName: "Solape Manual",
  });
  check("cita manual solapada → 409", dupManual.status === 409 && /cruza/i.test(dupManual.json?.error ?? ""), dupManual.json?.error);
  const dupSameBarber = await req(owner, "POST", "/api/appointments", {
    barberId: barber1Id, serviceId: svc1.id, date: D, time: toHM(toMin(slot1.time) + 15), clientName: "Solape Parcial H1",
  });
  check("solapamiento parcial sobre la reserva pública (mismo barbero) → 409", dupSameBarber.status === 409 && /cruza/i.test(dupSameBarber.json?.error ?? ""), dupSameBarber.json?.error);

  // ---------------- H.4 ----------------
  console.log("\n[H.4] Servicio completado genera la información para pago y comisión");
  const slotSan = await firstSlot(svc2.id, D, san.id);
  const appt4 = await req(owner, "POST", "/api/appointments", {
    barberId: san.id, serviceId: svc2.id, date: D, time: slotSan.time, clientName: "Flujo H4", clientPhone: "+573001110004",
  });
  check("cita de prueba creada (manual, Santiago)", appt4.status === 201, `código ${appt4.json?.appointment?.code}`);
  const id4: string = appt4.json?.appointment?.id;
  const skip = await req(owner, "PATCH", `/api/appointments/${id4}`, { action: "status", to: "COMPLETED" });
  check("no se puede saltar el flujo (RESERVED→COMPLETED rechazado)", skip.status === 400, skip.json?.error);
  await req(owner, "PATCH", `/api/appointments/${id4}`, { action: "status", to: "CONFIRMED" });
  await req(owner, "PATCH", `/api/appointments/${id4}`, { action: "status", to: "IN_ATTENTION" });
  const done = await req(owner, "PATCH", `/api/appointments/${id4}`, { action: "complete", discount: 3000 });
  check("completada con descuento 3000 (CONFIRMED→IN_ATTENTION→COMPLETED)", done.status === 200 && done.json?.appointment?.status === "COMPLETED");
  const com = done.json?.commission;
  check("comisión generada al completar (status PENDING_PAYMENT)", com?.status === "PENDING_PAYMENT");
  const neto4 = svc2.price - 3000;
  check(`base de comisión = venta neta (${neto4})`, com?.baseAmount === neto4, `base ${com?.baseAmount}`);
  const snap = (() => {
    try {
      return JSON.parse(com?.snapshotJson ?? "null");
    } catch {
      return null;
    }
  })();
  check("snapshot histórico guarda regla, precio y descuento del momento", !!snap?.rule && snap?.discount === 3000 && snap?.service?.priceSnapshotOfAppointment === svc2.price);
  const det4 = ((await req(owner, "GET", `/api/appointments?date=${D}`)).json.appointments ?? []).find((a: Json) => a.id === id4);
  check("información financiera lista para registrar el pago (neto y pendiente)", det4?.financial?.pendiente === neto4, `pendiente ${det4?.financial?.pendiente}`);

  // ---------------- H.5 ----------------
  console.log("\n[H.5] Un pago no se contabiliza dos veces");
  const reqId = `e2e-${Date.now()}`;
  const pay1 = await req(owner, "POST", "/api/payments", { appointmentId: id4, amount: neto4, method: "CASH", clientRequestId: reqId });
  check("primer pago registrado (201)", pay1.status === 201, `id ${pay1.json?.payment?.id}`);
  const pay2 = await req(owner, "POST", "/api/payments", { appointmentId: id4, amount: neto4, method: "CASH", clientRequestId: reqId });
  check("reintento con el mismo clientRequestId no duplica (mismo id de pago)", pay2.status === 200 && pay2.json?.duplicated === true && pay2.json?.payment?.id === pay1.json?.payment?.id);
  const pay3 = await req(owner, "POST", "/api/payments", { appointmentId: id4, amount: 1000, method: "CASH" });
  check("pago que excede el valor neto rechazado con 400", pay3.status === 400 && /excede/i.test(pay3.json?.error ?? ""), pay3.json?.error);
  const paysList = (await req(owner, "GET", `/api/payments?from=${todayKey()}&to=${todayKey()}`)).json.payments as Json[];
  const forAppt4 = paysList.filter((p: Json) => p.appointmentId === id4);
  check("la cita queda con exactamente un pago", forAppt4.length === 1, `pagos: ${forAppt4.length}`);

  // ---------------- H.6 ----------------
  console.log("\n[H.6] El propietario ve el consolidado del negocio");
  const sum = (await req(owner, "GET", "/api/reports/summary?preset=month")).json;
  const s = sum?.summary;
  check("resumen con ventas brutas/descuentos/netas", s?.ventas?.brutas >= 0 && s?.ventas?.descuentos >= 3000 && s?.ventas?.netas === s.ventas.brutas - s.ventas.descuentos);
  check("caja distingue cobrado, gastos y pagos a barberos", typeof s?.caja?.cobrado === "number" && typeof s?.caja?.gastos === "number" && typeof s?.caja?.totalPagosBarberos === "number");
  check("comisiones separadas en generadas/pagadas/pendientes", typeof s?.comisiones?.generadas === "number" && typeof s?.comisiones?.pagadas === "number");
  check("resultado operativo = netas − comisiones − gastos (una sola vez)", s?.resultado?.operativoEstimado === s.ventas.netas - s.comisiones.generadas - s.caja.gastos);
  const brk = (await req(owner, "GET", "/api/reports/breakdown?preset=month")).json;
  const rowSan = (brk?.byBarber ?? []).find((r: Json) => r.barberId === san.id);
  check("desglose por barbero con «del negocio» = netas − comisiones", !!rowSan && rowSan.negocio === rowSan.netas - rowSan.comisiones);
  const cash = (await req(owner, "GET", `/api/cash?from=${todayKey().slice(0, 8)}01&to=${D}`)).json;
  check("movimientos de caja incluyen el pago del período", (cash?.movements ?? []).some((m: Json) => m.source === "PAYMENT"));
  const dash = (await req(owner, "GET", "/api/dashboard")).json;
  check("panel del propietario carga consolidado día y mes", dash?.role === "OWNER" && !!dash?.monthSummary?.resultado);

  // ---------------- H.7 ----------------
  console.log("\n[H.7] Un barbero no puede acceder a información financiera ajena sin permiso");
  const otherComs = (await req(camilo, "GET", `/api/commissions?barberId=${san.id}`)).json.commissions as Json[];
  check("sin permiso: pedir comisiones de otro barbero devuelve solo las propias (0 ajenas)", otherComs.every((c: Json) => c.barberId === cam.id) && otherComs.length === 0, `recibidas: ${otherComs.length}`);
  const otherPays = (await req(camilo, "GET", `/api/payments?barberId=${san.id}`)).json.payments as Json[];
  check("sin permiso: pagos de otros barberos no visibles", otherPays.every((p: Json) => p.appointment?.barber?.id === cam.id));
  const forb1 = await req(camilo, "GET", "/api/reports/summary?preset=month");
  check("reportes del negocio → 403", forb1.status === 403);
  const forb2 = await req(camilo, "POST", "/api/commissions/config", { barberId: san.id, serviceId: null, commissionType: "PERCENT", percent: 99 });
  check("cambiar reglas de comisión → 403", forb2.status === 403);
  const forb3 = await req(camilo, "POST", "/api/expenses", { description: "x", category: "OTROS", amount: 1000 });
  check("registrar gastos → 403", forb3.status === 403);
  const forb4 = await req(camilo, "PUT", `/api/workers/${san.id}/availability`, { windows: [{ dayOfWeek: 2, startTime: "10:00", endTime: "11:00" }] });
  check("editar disponibilidad de otro → 403", forb4.status === 403);
  // permiso excepcional concedido por el propietario y validado en el servidor
  await req(owner, "PATCH", `/api/workers/${cam.id}`, { permissions: { "finance.viewOthers": true } });
  const withPerm = (await req(camilo, "GET", `/api/commissions?barberId=${san.id}`)).json.commissions as Json[];
  check("con permiso excepcional finance.viewOthers: sí ve comisiones ajenas", withPerm.some((c: Json) => c.barberId === san.id));
  await req(owner, "PATCH", `/api/workers/${cam.id}`, { permissions: { "finance.viewOthers": false } });
  const revoked = (await req(camilo, "GET", `/api/commissions?barberId=${san.id}`)).json.commissions as Json[];
  check("permiso revocado: vuelve a no verlas", !revoked.some((c: Json) => c.barberId === san.id));

  // ---------------- H.8 ----------------
  console.log("\n[H.8] Una liquidación refleja las comisiones y los pagos correspondientes");
  const pend = (await req(owner, "GET", `/api/commissions?barberId=${san.id}&status=PENDING_PAYMENT`)).json.commissions as Json[];
  check("hay comisiones pendientes para liquidar (de H.4)", pend.length >= 1, `pendientes: ${pend.length}`);
  const expectedTotal = pend.reduce((s2, c) => s2 + c.calculatedAmount, 0);
  const draft = await req(owner, "POST", "/api/settlements", {
    barberId: san.id,
    commissionIds: pend.map((c) => c.id),
    notes: "liquidación de validación H.8",
  });
  check("borrador creado con totales calculados por el servidor", draft.status === 201 && draft.json?.settlement?.totalCommissions === expectedTotal, `total ${draft.json?.settlement?.totalCommissions} (esperado ${expectedTotal})`);
  const setId: string = draft.json?.settlement?.id;
  const selfAppr = await req(santiago, "POST", `/api/settlements/${setId}/approve`);
  check("el barbero NO puede aprobar su propia liquidación (403)", selfAppr.status === 403, `HTTP ${selfAppr.status} ${selfAppr.json?.error ?? ""}`);
  const appr = await req(owner, "POST", `/api/settlements/${setId}/approve`);
  check("aprobada por el propietario", appr.status === 200 && appr.json?.settlement?.status === "APPROVED");
  const paid = await req(owner, "POST", `/api/settlements/${setId}/pay`, { method: "CASH" });
  check("pagada por el propietario", paid.status === 200 && paid.json?.settlement?.status === "PAID");
  const after = (await req(owner, "GET", `/api/commissions?barberId=${san.id}`)).json.commissions as Json[];
  const includedIds = new Set(pend.map((c) => c.id));
  check("las comisiones liquidadas quedan PAID", after.filter((c) => includedIds.has(c.id)).every((c) => c.status === "PAID"));
  const cash2 = (await req(owner, "GET", `/api/cash?from=${todayKey().slice(0, 8)}01&to=${addDays(todayKey(), 1)}`)).json;
  check("el pago de la liquidación queda como egreso en caja", (cash2?.movements ?? []).some((m: Json) => m.source === "SETTLEMENT" && m.amount === expectedTotal));

  // ---------------- H.9 ----------------
  console.log("\n[H.9] Los cambios de tarifas no alteran operaciones históricas");
  const comsAfter = (await req(owner, "GET", `/api/commissions?barberId=${san.id}`)).json.commissions as Json[];
  const hist = comsAfter.find((c) => includedIds.has(c.id));
  const histAmount = hist.calculatedAmount;
  const histBase = hist.baseAmount;
  const histSnapshot = hist.snapshotJson;
  const oldPrice = svc2.price;
  await req(owner, "PATCH", `/api/services/${svc2.id}`, { price: oldPrice + 40000 });
  await req(owner, "POST", "/api/commissions/config", { barberId: san.id, serviceId: null, commissionType: "PERCENT", percent: 70, note: "cambio agresivo H.9" });
  const comsPost = (await req(owner, "GET", `/api/commissions?barberId=${san.id}`)).json.commissions as Json[];
  const histPost = comsPost.find((c) => includedIds.has(c.id));
  check("comisión histórica: mismo valor tras cambiar precio y regla", histPost.calculatedAmount === histAmount, `${histAmount} → ${histPost.calculatedAmount}`);
  check("comisión histórica: misma base neta", histPost.baseAmount === histBase);
  check("comisión histórica: mismo snapshot (copia inmutable)", histPost.snapshotJson === histSnapshot);
  const detPost = ((await req(owner, "GET", `/api/appointments?date=${D}`)).json.appointments ?? []).find((a: Json) => a.id === id4);
  check("cita histórica conserva su precio copiado (priceSnapshot)", detPost?.priceSnapshot === oldPrice, `${detPost?.priceSnapshot} (original ${oldPrice})`);
  const newRuleEff = (await req(owner, "GET", "/api/commissions/config")).json.current.find((r: Json) => r.barberId === san.id && r.serviceId === null);
  check("la nueva versión de la regla es la vigente (70%)", newRuleEff?.percent === 70);
  // restaurar estado: precio original y regla por defecto
  await req(owner, "PATCH", `/api/services/${svc2.id}`, { price: oldPrice });
  await req(owner, "POST", "/api/commissions/config", { barberId: san.id, serviceId: null, commissionType: "PERCENT", percent: 40, note: "regla defecto Santiago" });

  // ---------------- H.10 (sin configurar) ----------------
  console.log("\n[H.10a] WhatsApp sin configurar: falla de forma controlada y todo sigue funcionando");
  const wa = (await req(owner, "GET", "/api/whatsapp/status")).json;
  check("estado: integración pendiente de configuración", wa?.config?.configured === false);
  const recent: Json[] = wa?.recent ?? [];
  const msg1 = recent.find((m: Json) => m.appointmentCode === code1 && m.messageType === "CONFIRMATION");
  check("mensaje de la reserva H.1 quedó PENDING_CONFIG (sin afirmar envío)", msg1?.status === "PENDING_CONFIG", `estado ${msg1?.status}`);
  check("sin id de proveedor inventado", !msg1?.providerMessageId);
  const agendaStill = await req(owner, "GET", `/api/appointments?date=${D}`);
  check("la agenda sigue funcionando sin WhatsApp", agendaStill.status === 200);
  const notifBarber = (await req(santiago, "GET", "/api/notifications")).json.notifications as Json[];
  check("notificación interna generada igualmente", notifBarber.length > 0, `${notifBarber.length} notificaciones`);
  const testSend = await req(owner, "POST", "/api/whatsapp/test", { to: "+573001234567" });
  check("envío de prueba rechazado con explicación (400)", testSend.status === 400 && /pendiente de configuración/i.test(testSend.json?.error ?? ""));

  // limpieza: cancelar las citas de prueba que siguen activas
  const cal1b = (await req(owner, "GET", `/api/appointments?date=${D}`)).json.appointments ?? [];
  const a1 = cal1b.find((a: Json) => a.code === code1);
  if (a1) await req(owner, "PATCH", `/api/appointments/${a1.id}`, { action: "status", to: "CANCELLED", reason: "limpieza de validación H.1" });
  if (manualCamId) await req(owner, "PATCH", `/api/appointments/${manualCamId}`, { action: "status", to: "CANCELLED", reason: "limpieza de validación H.2" });

  console.log(`\n──────── FASE A: ${passed} pass · ${failed} fail ────────`);
  if (failures.length) failures.forEach((f) => console.log(`  ✗ ${f}`));
}

// ================================================================ FASE B
async function phaseB() {
  console.log("\n════════ FASE B · H.10 con proveedor simulado (WhatsApp configurado) ════════");
  const owner = await login("owner@melo.com");
  const wa0 = (await req(owner, "GET", "/api/whatsapp/status")).json;
  check("integración configurada con el proveedor simulado", wa0?.config?.configured === true, `proveedor: ${wa0?.config?.provider}`);

  // 1) envío exitoso con id del proveedor
  const ok = await req(owner, "POST", "/api/whatsapp/test", { to: "+573001234567" });
  check("mensaje de prueba enviado → SENT con id del proveedor", ok.status === 200 && ok.json?.status === "SENT", `id ${ok.json?.record?.providerMessageId}`);

  // 2) confirmación real al reservar
  const D = nextWorkingDay(3);
  const cat = (await req(null, "GET", "/api/public/catalog")).json;
  const svc = cat.services[3]; // Diseño y Afinado (20 min)
  const slot = await firstSlot(svc.id, D, "ANY");
  const booked = await publicBook({ serviceId: svc.id, date: D, time: slot.time, barberId: "ANY", clientName: "Cliente WhatsApp OK", clientPhone: "+573005550011" });
  check("reserva con teléfono creada", booked.status === 201 && booked.json?.appointment?.code != null, `código ${booked.json?.appointment?.code}`);
  const codeOK: string = booked.json.appointment.code;

  // 3) fallo controlado: número con "999" agota reintentos y queda FAILED
  const t0 = Date.now();
  const failBook = await publicBook({ serviceId: svc.id, date: D, time: toHM(toMin(slot.time) + 120), barberId: "ANY", clientName: "Cliente WhatsApp FAIL", clientPhone: "+573005559999" });
  check("la reserva se crea aunque el proveedor falle (fail-safe)", failBook.status === 201, `código ${failBook.json?.appointment?.code}`);
  const codeFail: string = failBook.json?.appointment?.code;

  // 4) fallo transitorio: número con "888" sale al 3.er intento
  const flakyBook = await publicBook({ serviceId: svc.id, date: D, time: toHM(toMin(slot.time) + 240), barberId: "ANY", clientName: "Cliente WhatsApp FLAKY", clientPhone: "+573005558888" });
  const codeFlaky: string = flakyBook.json?.appointment?.code;

  // esperar reintentos automáticos (2 s + 8 s por mensaje)
  console.log("  esperando reintentos automáticos (hasta 20 s)…");
  let msgFail: Json | undefined;
  let msgFlaky: Json | undefined;
  let msgOK: Json | undefined;
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const st = (await req(owner, "GET", "/api/whatsapp/status")).json;
    const rec: Json[] = st.recent ?? [];
    msgOK = rec.find((m: Json) => m.appointmentCode === codeOK);
    msgFail = rec.find((m: Json) => m.appointmentCode === codeFail);
    msgFlaky = rec.find((m: Json) => m.appointmentCode === codeFlaky);
    if (msgFail?.status === "FAILED" && msgFlaky?.status === "SENT") break;
  }
  check("confirmación de reserva enviada (SENT, id wamid)", msgOK?.status === "SENT" && String(msgOK?.providerMessageId ?? "").startsWith("wamid"), `estado ${msgOK?.status}`);
  check("proveedor que siempre falla → FAILED tras 3 intentos (controlado)", msgFail?.status === "FAILED" && msgFail?.attempts === 3, `estado ${msgFail?.status}, intentos ${msgFail?.attempts}`);
  check("error del proveedor registrado (nunca se afirma que se envió)", typeof msgFail?.error === "string" && msgFail.error.length > 0, String(msgFail?.error ?? "").slice(0, 60));
  check("fallo transitorio → reintentos automáticos hasta SENT (3.er intento)", msgFlaky?.status === "SENT" && msgFlaky?.attempts === 3, `estado ${msgFlaky?.status}, intentos ${msgFlaky?.attempts}`);

  // 5) deduplicación: el mismo evento no genera doble mensaje
  const dups = ((await req(owner, "GET", "/api/whatsapp/status")).json.recent ?? []).filter((m: Json) => m.appointmentCode === codeOK);
  check("protección contra notificaciones duplicadas (1 mensaje por evento)", dups.length === 1, `mensajes: ${dups.length}`);

  // 6) reintento manual controlado y agenda operativa
  const retry = await req(owner, "POST", "/api/whatsapp/retry");
  check("reintento manual de fallidos responde sin error", retry.status === 200);
  const agenda = await req(owner, "GET", `/api/appointments?date=${D}`);
  check("la agenda sigue operativa durante fallos de WhatsApp", agenda.status === 200);
  console.log(`  (fase B completada en ${((Date.now() - t0) / 1000).toFixed(0)} s)`);

  // limpieza: cancelar las citas de prueba creadas en esta fase
  const list = (await req(owner, "GET", `/api/appointments?date=${D}`)).json.appointments as Json[];
  for (const code of [codeOK, codeFail, codeFlaky]) {
    const a = list.find((x: Json) => x.code === code);
    if (a && (a.status === "RESERVED" || a.status === "CONFIRMED")) {
      await req(owner, "PATCH", `/api/appointments/${a.id}`, { action: "status", to: "CANCELLED", reason: "limpieza de validación H.10" }).catch(() => undefined);
    }
  }

  console.log(`\n──────── FASE B: ${passed} pass · ${failed} fail ────────`);
  if (failures.length) failures.forEach((f) => console.log(`  ✗ ${f}`));
}

// ================================================================ SMOKE
async function smoke() {
  console.log("\n════════ SMOKE ════════");
  const cat = await req(null, "GET", "/api/public/catalog");
  check("catálogo público", cat.status === 200 && cat.json?.services?.length > 0);
  const login1 = await req(null, "POST", "/api/auth/login", { email: "owner@melo.com", password: "melo1234" });
  check("login propietario", login1.status === 200);
  console.log(`──────── ${passed} pass · ${failed} fail ────────`);
}

// ================================================================ ENTORNO
/** Activa/comenta las variables WHATSAPP_* de .env (proveedor simulado). */
function setMockEnv(enabled: boolean) {
  const path = ".env";
  const original = readFileSync(path, "utf8");
  const lines = original.split("\n");
  const out = lines.map((line) => {
    if (!/^\s*#?\s*WHATSAPP_/.test(line)) return line;
    return enabled ? line.replace(/^\s*#\s*/, "") : line.replace(/^([^#])/, "#$1");
  });
  if (enabled && !out.some((l) => /^WHATSAPP_TOKEN=/.test(l))) {
    out.push(
      "WHATSAPP_TOKEN=mock-token-para-validacion",
      "WHATSAPP_PHONE_NUMBER_ID=123456789",
      "WHATSAPP_API_URL=http://localhost:3000/api/whatsapp/mock"
    );
  }
  writeFileSync(path, out.join("\n"));
  return original;
}

async function waitServer(seconds = 120): Promise<boolean> {
  for (let i = 0; i < seconds / 2; i++) {
    try {
      const r = await fetch(`${BASE}/api/public/catalog`);
      if (r.ok) return true;
    } catch {
      /* aún no */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function restartDev(): Promise<void> {
  try {
    execSync("pkill -f 'next dev -p 3000' || true", { stdio: "ignore" });
    execSync("pkill -f 'zscripts/dev.sh' || true", { stdio: "ignore" });
    execSync("pkill -f 'tee dev.log' || true", { stdio: "ignore" });
  } catch {
    /* sin procesos */
  }
  await new Promise((r) => setTimeout(r, 3000));
  execSync("nohup bash .zscripts/dev.sh > .zscripts/dev-restart.log 2>&1 &", { stdio: "ignore" });
  const okUp = await waitServer();
  if (!okUp) throw new Error("el servidor no volvió a responder tras el reinicio");
  console.log("  servidor reiniciado.");
}

// ================================================================ MAIN
async function main() {
  const phase = process.argv[2] ?? "smoke";
  const started = Date.now();
  if (phase === "phaseA") {
    await phaseA();
  } else if (phase === "phaseB") {
    await phaseB();
  } else if (phase === "all") {
    // 1) Fase A sin WhatsApp configurado
    await phaseA();
    // 2) Activar proveedor simulado y reiniciar
    const originalEnv = setMockEnv(true);
    console.log("\n  [config] .env con proveedor simulado; reiniciando servidor…");
    await restartDev();
    // 3) Fase B (WhatsApp configurado)
    await phaseB();
    // 4) Restaurar .env y reiniciar (estado final: pendiente de configuración)
    writeFileSync(".env", originalEnv);
    console.log("\n  [config] .env restaurado; reiniciando servidor…");
    await restartDev();
    const owner = await login("owner@melo.com");
    const waFinal = (await req(owner, "GET", "/api/whatsapp/status")).json;
    check("estado final: integración vuelve a «pendiente de configuración»", waFinal?.config?.configured === false);
  } else {
    await smoke();
  }
  const secs = ((Date.now() - started) / 1000).toFixed(0);
  console.log(`\nRESULTADO FINAL: ${passed} pass · ${failed} fail (${secs} s)`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("ERROR FATAL:", e);
  process.exit(1);
});
