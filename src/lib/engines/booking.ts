"use client";
// Motor de reservas en cliente: disponibilidad, solapamientos y flujo de la cita.
import {
  type Appointment, type AppointmentStatus, type DB, mutateDB, getDB, audit, pushNotification,
  appointmentCode, cuid,
} from "@/lib/store";
import {
  dateKeyInBogota, dayOfWeekInBogota, dayStartUtc, bogotaToUtc, parseHM, hm,
  minutesInBogota, overlaps, todayKey,
} from "@/lib/time";
import { getAdminData } from "@/lib/store";

export const SLOT_STEP = 15;
export const PUBLIC_MIN_LEAD_MIN = 15;
export const BLOCKING_STATUSES: AppointmentStatus[] = ["RESERVED", "CONFIRMED", "IN_ATTENTION", "COMPLETED"];

export const TRANSITIONS: Record<string, AppointmentStatus[]> = {
  RESERVED: ["CONFIRMED", "CANCELLED", "NO_SHOW"],
  CONFIRMED: ["IN_ATTENTION", "CANCELLED", "NO_SHOW"],
  IN_ATTENTION: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export class BizError extends Error {}

function fail(msg: string): never {
  throw new BizError(msg);
}

// ---------- disponibilidad ----------
export type SlotInfo = { time: string; startMin: number; barbers: string[] };

export function slotsForService(db: DB, serviceId: string, dateKey: string, barberChoice: string): SlotInfo[] {
  const service = db.services.find((s) => s.id === serviceId && s.active);
  if (!service) return [];
  const dayStart = dayStartUtc(dateKey);
  const dow = dayOfWeekInBogota(dayStart);
  const now = new Date();

  const candidates =
    barberChoice === "ANY"
      ? db.barbers.filter((b) => b.active && db.barberServices[`${b.id}:${serviceId}`])
      : db.barbers.filter((b) => b.id === barberChoice && b.active && db.barberServices[`${b.id}:${serviceId}`]);
  if (candidates.length === 0) return [];

  const todayK = todayKey();
  const minStart =
    dateKey === todayK ? minutesInBogota(now) + PUBLIC_MIN_LEAD_MIN : dateKey < todayK ? 24 * 60 + 1 : -1;

  const byMinute = new Map<number, Set<string>>();
  for (const b of candidates) {
    const windows = (db.availability[b.id] ?? []).filter((w) => w.dayOfWeek === dow && w.active);
    const blocking = db.appointments.filter(
      (a) => a.barberId === b.id && BLOCKING_STATUSES.includes(a.status) &&
        a.startTime < new Date(dayStart.getTime() + 24 * 3600 * 1000).toISOString() &&
        a.endTime > dayStart.toISOString()
    );
    for (const w of windows) {
      const ws = parseHM(w.startTime);
      const we = parseHM(w.endTime);
      for (let m = ws; m + service.durationMin <= we; m += SLOT_STEP) {
        if (minStart >= 0 && m < minStart) continue;
        const s = new Date(dayStart.getTime() + m * 60000);
        const e = new Date(s.getTime() + service.durationMin * 60000);
        const busy = blocking.some((b2) => overlaps(s, e, new Date(b2.startTime), new Date(b2.endTime)));
        if (busy) continue;
        if (!byMinute.has(m)) byMinute.set(m, new Set());
        byMinute.get(m)!.add(b.id);
      }
    }
  }
  return Array.from(byMinute.entries())
    .map(([m, set]) => ({ time: hm(m), startMin: m, barbers: Array.from(set) }))
    .sort((a, b) => a.startMin - b.startMin);
}

// ---------- creación ----------
export type CreateInput = {
  barberId: string; // "ANY" o id
  serviceId: string;
  dateKey: string;
  startMin: number;
  clientName: string;
  clientPhone?: string | null;
  origin: "PUBLIC" | "MANUAL";
  createdByName: string;
  notes?: string | null;
  allowPastToday?: boolean;
};

function pickBarberForAny(db: DB, serviceId: string, dateKey: string, startMin: number, durationMin: number): string {
  const dayStart = dayStartUtc(dateKey);
  const dow = dayOfWeekInBogota(dayStart);
  const start = new Date(dayStart.getTime() + startMin * 60000);
  const end = new Date(start.getTime() + durationMin * 60000);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);

  const candidates: Array<{ id: string; count: number; name: string }> = [];
  for (const b of db.barbers) {
    if (!b.active || !db.barberServices[`${b.id}:${serviceId}`]) continue;
    const windows = (db.availability[b.id] ?? []).filter((w) => w.dayOfWeek === dow && w.active);
    const covered = windows.some((w) => startMin >= parseHM(w.startTime) && startMin + durationMin <= parseHM(w.endTime));
    if (!covered) continue;
    const busy = db.appointments.some(
      (a) => a.barberId === b.id && BLOCKING_STATUSES.includes(a.status) &&
        a.startTime < dayEnd.toISOString() && a.endTime > dayStart.toISOString() &&
        overlaps(start, end, new Date(a.startTime), new Date(a.endTime))
    );
    if (busy) continue;
    const count = db.appointments.filter(
      (a) => a.barberId === b.id && BLOCKING_STATUSES.includes(a.status) && a.startTime >= dayStart.toISOString() && a.startTime < dayEnd.toISOString()
    ).length;
    candidates.push({ id: b.id, count, name: b.name });
  }
  if (candidates.length === 0) fail("Ningún barbero disponible en ese horario");
  candidates.sort((a, b) => a.count - b.count || a.name.localeCompare(b.name));
  return candidates[0].id;
}

export function createAppointment(input: CreateInput): Appointment {
  const db = getDB();
  const service = db.services.find((s) => s.id === input.serviceId && s.active);
  if (!service) fail("El servicio no existe o está inactivo");

  const barberId =
    input.barberId === "ANY"
      ? pickBarberForAny(db, input.serviceId, input.dateKey, input.startMin, service.durationMin)
      : input.barberId;
  const barber = db.barbers.find((b) => b.id === barberId && b.active);
  if (!barber) fail("El barbero no existe o está inactivo");
  if (!db.barberServices[`${barberId}:${input.serviceId}`]) fail("El barbero no está autorizado para ofrecer este servicio");

  const dayStart = dayStartUtc(input.dateKey);
  const startTime = new Date(dayStart.getTime() + input.startMin * 60000);
  const endTime = new Date(startTime.getTime() + service.durationMin * 60000);
  const now = new Date();

  if (input.dateKey < todayKey()) fail("No se pueden crear citas en días pasados");
  if (input.origin === "PUBLIC") {
    if (endTime.getTime() < now.getTime() + PUBLIC_MIN_LEAD_MIN * 60000) {
      fail("La reserva pública debe tener al menos 15 minutos de anticipación");
    }
  } else if (!input.allowPastToday && startTime.getTime() < now.getTime()) {
    fail("La hora de la cita debe ser futura");
  }

  const dow = dayOfWeekInBogota(dayStart);
  const windows = (db.availability[barberId] ?? []).filter((w) => w.dayOfWeek === dow && w.active);
  const covered = windows.some(
    (w) => input.startMin >= parseHM(w.startTime) && input.startMin + service.durationMin <= parseHM(w.endTime)
  );
  if (!covered) fail("La hora no está dentro de la disponibilidad del barbero");

  const conflict = db.appointments.some(
    (a) => a.barberId === barberId && BLOCKING_STATUSES.includes(a.status) &&
      overlaps(startTime, endTime, new Date(a.startTime), new Date(a.endTime))
  );
  if (conflict) fail("El horario se cruza con otra cita del barbero");

  const codes = new Set(db.appointments.map((a) => a.code));
  const appt: Appointment = {
    id: cuid("apt"),
    code: appointmentCode(),
    barberId,
    serviceId: input.serviceId,
    origin: input.origin,
    status: "RESERVED",
    clientName: input.clientName.trim(),
    clientPhone: input.clientPhone?.trim() || null,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    priceSnapshot: service.price,
    discount: 0,
    notes: input.notes?.trim() || null,
    cancelReason: null,
    completedAt: null,
    createdAt: now.toISOString(),
  };
  while (codes.has(appt.code)) appt.code = appointmentCode();

  mutateDB((d) => {
    d.appointments.push(appt);
  });
  audit("APPOINTMENT", appt.id, "CREATE", input.createdByName, null, appt);

  const admin = getAdminData();
  if (input.origin === "PUBLIC" && admin.notif.notifyOnBooking) {
    pushNotification(
      "OWNER",
      "appointment.created",
      "🆕 Nueva reserva web",
      `${service.name} · ${input.clientName} · ${dateKeyInBogota(startTime)} ${hm(input.startMin)} con ${barber.name} · código ${appt.code}`
    );
    pushNotification(
      barberId,
      "appointment.created",
      "🆕 Nueva reserva",
      `${service.name} · ${input.clientName} · ${dateKeyInBogota(startTime)} ${hm(input.startMin)} · código ${appt.code}`
    );
  }
  return appt;
}

// ---------- acciones sobre la cita ----------
export function changeStatus(apptId: string, to: AppointmentStatus, actorName: string, reason?: string): Appointment {
  const db = getDB();
  const appt = db.appointments.find((a) => a.id === apptId);
  if (!appt) fail("Cita no encontrada");
  const allowed = TRANSITIONS[appt.status] ?? [];
  if (!allowed.includes(to)) fail(`Transición inválida: ${appt.status} → ${to}`);
  const before = { ...appt };

  mutateDB((d) => {
    const a = d.appointments.find((x) => x.id === apptId)!;
    a.status = to;
    if (to === "CANCELLED") a.cancelReason = reason?.trim() || "Sin motivo";
    if (to === "COMPLETED") a.completedAt = new Date().toISOString();
  });

  const updated = getDB().appointments.find((a) => a.id === apptId)!;
  audit("APPOINTMENT", apptId, `STATUS_${to}`, actorName, before, updated);

  const admin = getAdminData();
  const service = db.services.find((s) => s.id === appt.serviceId);
  const barber = db.barbers.find((b) => b.id === appt.barberId);
  if (to === "CANCELLED" && admin.notif.notifyOnCancel) {
    pushNotification("OWNER", "appointment.cancelled", "❌ Cita cancelada", `${appt.code} · ${service?.name} · ${appt.clientName} · motivo: ${updated.cancelReason}`);
    pushNotification(appt.barberId, "appointment.cancelled", "❌ Cita cancelada", `${appt.code} · ${service?.name} · ${appt.clientName}`);
  }
  if (to === "CONFIRMED") {
    pushNotification(appt.barberId, "appointment.confirmed", "✅ Cita confirmada", `${appt.code} · ${service?.name} · ${appt.clientName}`);
  }
  return updated;
}

export function completeAppointment(apptId: string, discount: number, actorName: string): { appointment: Appointment } {
  const db = getDB();
  const appt = db.appointments.find((a) => a.id === apptId);
  if (!appt) fail("Cita no encontrada");
  if (appt.status !== "IN_ATTENTION") fail("Solo se completa una cita en atención");
  if (discount < 0 || discount > appt.priceSnapshot) fail("Descuento inválido");
  if (db.commissions.some((c) => c.appointmentId === apptId)) fail("La cita ya tiene una comisión registrada");

  const base = appt.priceSnapshot - discount;
  const now = new Date();

  // regla vigente: específica > defecto del barbero
  const rule =
    db.commissionRules.find((r) => r.barberId === appt.barberId && r.serviceId === appt.serviceId && !r.validTo) ??
    db.commissionRules.find((r) => r.barberId === appt.barberId && r.serviceId === null && !r.validTo) ??
    null;
  const source: "SPECIFIC" | "BARBER_DEFAULT" | "NONE" = rule ? (rule.serviceId ? "SPECIFIC" : "BARBER_DEFAULT") : "NONE";
  const configured = !!rule;
  let amount = 0;
  if (rule) {
    const percent = rule.percent ?? 0;
    const fixed = rule.fixedAmount ?? 0;
    if (rule.commissionType === "PERCENT") amount = Math.round((base * percent) / 100);
    else if (rule.commissionType === "FIXED") amount = fixed;
    else amount = Math.round((base * percent) / 100) + fixed;
  }
  const service = db.services.find((s) => s.id === appt.serviceId);
  const ruleLabel = rule
    ? rule.commissionType === "PERCENT" ? `${rule.percent}% de la venta neta`
      : rule.commissionType === "FIXED" ? `$ ${rule.fixedAmount} fijo por servicio`
        : `${rule.percent}% + $ ${rule.fixedAmount} (mixto)`
    : "Sin regla vigente";

  mutateDB((d) => {
    const a = d.appointments.find((x) => x.id === apptId)!;
    a.status = "COMPLETED";
    a.discount = discount;
    a.completedAt = now.toISOString();
    d.commissions.push({
      id: cuid("com"),
      appointmentId: apptId,
      barberId: appt.barberId,
      status: configured ? "PENDING_PAYMENT" : "PENDING_CONFIG",
      configured,
      commissionType: rule?.commissionType ?? null,
      percent: rule?.percent ?? null,
      fixedAmount: rule?.fixedAmount ?? null,
      baseAmount: base,
      calculatedAmount: amount,
      manualSet: false,
      manualReason: null,
      snapshot: {
        serviceName: service?.name ?? "?",
        servicePrice: service?.price ?? 0,
        appointmentPrice: appt.priceSnapshot,
        discount,
        base,
        ruleLabel,
        ruleSource: source,
        completedAt: now.toISOString(),
      },
      createdAt: now.toISOString(),
    });
  });

  const updated = getDB().appointments.find((a) => a.id === apptId)!;
  audit("APPOINTMENT", apptId, "COMPLETE", actorName, appt, updated);
  audit("COMMISSION", apptId, "CREATE_SNAPSHOT", actorName, null, { base, amount, ruleLabel });

  const admin = getAdminData();
  if (admin.notif.notifyOnComplete) {
    pushNotification("OWNER", "appointment.completed", "✂️ Servicio completado", `${appt.code} · ${service?.name} · ${appt.clientName} · comisión ${configured ? "generada" : "sin configurar"}`);
    pushNotification(appt.barberId, "appointment.completed", "✂️ Servicio completado", `${appt.code} · ${service?.name} · ${appt.clientName}`);
  }
  return { appointment: updated };
}

export function rescheduleAppointment(apptId: string, dateKey: string, time: string, barberId: string, actorName: string): Appointment {
  const db = getDB();
  const appt = db.appointments.find((a) => a.id === apptId);
  if (!appt) fail("Cita no encontrada");
  if (appt.status !== "RESERVED" && appt.status !== "CONFIRMED") fail("Solo se reprograman citas reservadas o confirmadas");
  const service = db.services.find((s) => s.id === appt.serviceId);
  if (!service) fail("Servicio no encontrado");
  if (!db.barberServices[`${barberId}:${appt.serviceId}`]) fail("El barbero no está autorizado para ese servicio");

  const dayStart = dayStartUtc(dateKey);
  const startMin = parseHM(time);
  const startTime = new Date(dayStart.getTime() + startMin * 60000);
  const endTime = new Date(startTime.getTime() + service.durationMin * 60000);

  const dow = dayOfWeekInBogota(dayStart);
  const windows = (db.availability[barberId] ?? []).filter((w) => w.dayOfWeek === dow && w.active);
  const covered = windows.some((w) => startMin >= parseHM(w.startTime) && startMin + service.durationMin <= parseHM(w.endTime));
  if (!covered) fail("La nueva hora no está dentro de la disponibilidad del barbero");

  const conflict = db.appointments.some(
    (a) => a.id !== apptId && a.barberId === barberId && BLOCKING_STATUSES.includes(a.status) &&
      overlaps(startTime, endTime, new Date(a.startTime), new Date(a.endTime))
  );
  if (conflict) fail("El nuevo horario se cruza con otra cita del barbero");

  const before = { ...appt };
  mutateDB((d) => {
    const a = d.appointments.find((x) => x.id === apptId)!;
    a.barberId = barberId;
    a.startTime = startTime.toISOString();
    a.endTime = endTime.toISOString();
  });
  const updated = getDB().appointments.find((a) => a.id === apptId)!;
  audit("APPOINTMENT", apptId, "RESCHEDULE", actorName, before, updated);
  return updated;
}

// ---------- pagos ----------
export function registerPayment(params: {
  appointmentId: string;
  amount: number;
  method: "CASH" | "TRANSFER" | "CARD" | "OTHER";
  externalRef?: string | null;
  registeredByName: string;
  registeredById: string;
}): void {
  const db = getDB();
  const appt = db.appointments.find((a) => a.id === params.appointmentId);
  if (!appt) fail("Cita no encontrada");
  if (appt.status !== "COMPLETED") fail("Solo se registran pagos en citas completadas");
  const pagado = db.payments
    .filter((p) => p.appointmentId === params.appointmentId)
    .reduce((s, p) => s + p.amount - p.refundedAmount, 0);
  const net = appt.priceSnapshot - appt.discount;
  if (params.amount <= 0) fail("El monto debe ser mayor que cero");
  if (pagado + params.amount > net) fail("El pago supera el valor neto de la cita");

  const payment = {
    id: cuid("pay"),
    appointmentId: params.appointmentId,
    amount: Math.round(params.amount),
    method: params.method,
    status: "CONFIRMED" as const,
    refundedAmount: 0,
    externalRef: params.externalRef || null,
    notes: null,
    refundReason: null,
    receivedAt: new Date().toISOString(),
    registeredById: params.registeredById,
    registeredByName: params.registeredByName,
  };
  mutateDB((d) => {
    d.payments.push(payment);
  });
  audit("PAYMENT", payment.id, "CREATE", params.registeredByName, null, payment);

  const admin = getAdminData();
  if (admin.notif.notifyOnPayment) {
    const service = db.services.find((s) => s.id === appt.serviceId);
    pushNotification("OWNER", "payment.registered", "💰 Pago registrado", `${appt.code} · ${service?.name} · ${params.method} · $ ${payment.amount.toLocaleString("es-CO")}`);
  }
}

export function refundPayment(paymentId: string, amount: number, reason: string, actorName: string): void {
  const db = getDB();
  const p = db.payments.find((x) => x.id === paymentId);
  if (!p) fail("Pago no encontrado");
  const max = p.amount - p.refundedAmount;
  if (amount <= 0 || amount > max) fail("Monto de devolución inválido");
  if (!reason?.trim()) fail("El motivo es obligatorio");
  const before = { ...p };
  mutateDB((d) => {
    const pay = d.payments.find((x) => x.id === paymentId)!;
    pay.refundedAmount += Math.round(amount);
    pay.status = pay.refundedAmount >= pay.amount ? "REFUNDED" : "PARTIALLY_REFUNDED";
    pay.refundReason = reason.trim();
  });
  const updated = getDB().payments.find((x) => x.id === paymentId)!;
  audit("PAYMENT", paymentId, "REFUND", actorName, before, updated);
}

export function appointmentFinancial(db: DB, apptId: string) {
  const appt = db.appointments.find((a) => a.id === apptId)!;
  const net = appt.priceSnapshot - appt.discount;
  const pays = db.payments.filter((p) => p.appointmentId === apptId);
  const pagado = pays.reduce((s, p) => s + p.amount - p.refundedAmount, 0);
  const commission = db.commissions.find((c) => c.appointmentId === apptId) ?? null;
  return {
    net,
    pagado,
    pendiente: Math.max(0, net - pagado),
    commission: commission
      ? { status: commission.status, amount: commission.calculatedAmount, configured: commission.configured, id: commission.id }
      : null,
  };
}

// utilidad para slots libres de un barbero concreto (dialog manual)
export function freeSlotsForBarber(db: DB, barberId: string, serviceId: string, dateKey: string): string[] {
  const service = db.services.find((s) => s.id === serviceId);
  if (!service) return [];
  return slotsForService(db, serviceId, dateKey, barberId).map((s) => s.time);
}
