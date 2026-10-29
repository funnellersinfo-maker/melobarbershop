// Motor de reservas: disponibilidad semanal, cálculo de huecos, prevención de
// solapamientos (público y manual comparten las mismas validaciones) y
// transiciones de estado de la cita.
import { db } from "@/lib/db";
import { ApiError } from "@/lib/http";
import type { Prisma, Appointment } from "@prisma/client";
import {
  dateKeyInBogota,
  dayOfWeekInBogota,
  dayStartUtc,
  bogotaToUtc,
  parseHM,
  hm,
  minutesInBogota,
  overlaps,
} from "@/lib/time";

export const SLOT_STEP = 15; // minutos
export const PUBLIC_MIN_LEAD_MIN = 15; // reserva pública: mínimo 15 min hacia adelante
export const BLOCKING_STATUSES = ["RESERVED", "CONFIRMED", "IN_ATTENTION", "COMPLETED"] as const;

// Transiciones permitidas del flujo de la cita (requisito B)
export const TRANSITIONS: Record<string, string[]> = {
  RESERVED: ["CONFIRMED", "CANCELLED", "NO_SHOW"],
  CONFIRMED: ["IN_ATTENTION", "CANCELLED", "NO_SHOW"],
  IN_ATTENTION: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export function assertTransition(from: string, to: string) {
  const allowed = TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new ApiError(400, `Transición inválida: ${from} → ${to}`);
  }
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function appointmentCode(): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return `MB-${s}`;
}

export async function generateUniqueCode(tx: Prisma.TransactionClient): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = appointmentCode();
    const exists = await tx.appointment.findUnique({ where: { code }, select: { id: true } });
    if (!exists) return code;
  }
  throw new ApiError(500, "No fue posible generar un código de cita único");
}

// ---------- Disponibilidad ----------

export type BarberWindow = { barberId: string; startMin: number; endMin: number };

export async function windowsForDate(barberIds: string[], dateKey: string): Promise<BarberWindow[]> {
  if (barberIds.length === 0) return [];
  const dow = dayOfWeekInBogota(dayStartUtc(dateKey));
  const rows = await db.availability.findMany({
    where: { barberId: { in: barberIds }, dayOfWeek: dow, active: true },
  });
  return rows.map((r) => ({ barberId: r.barberId, startMin: parseHM(r.startTime), endMin: parseHM(r.endTime) }))
    .filter((w) => w.endMin > w.startMin)
    .sort((a, b) => a.startMin - b.startMin);
}

export async function blockingAppointments(tx: Prisma.TransactionClient, barberId: string, dayStart: Date, dayEnd: Date) {
  return tx.appointment.findMany({
    where: {
      barberId,
      status: { in: BLOCKING_STATUSES as unknown as string[] },
      startTime: { lt: dayEnd },
      endTime: { gt: dayStart },
    },
    select: { startTime: true, endTime: true },
  });
}

function isFree(blocking: { startTime: Date; endTime: Date }[], startMin: number, endMin: number, dayStart: Date): boolean {
  const s = new Date(dayStart.getTime() + startMin * 60000);
  const e = new Date(dayStart.getTime() + endMin * 60000);
  return !blocking.some((b) => overlaps(s, e, b.startTime, b.endTime));
}

export type SlotInfo = { time: string; startMin: number };

export function slotsInWindows(
  windows: BarberWindow[],
  durationMin: number,
  blocking: { startTime: Date; endTime: Date }[],
  dayStart: Date,
  minStartMin?: number
): SlotInfo[] {
  const out: SlotInfo[] = [];
  const seen = new Set<number>();
  for (const w of windows) {
    for (let m = w.startMin; m + durationMin <= w.endMin; m += SLOT_STEP) {
      if (minStartMin !== undefined && m < minStartMin) continue;
      if (seen.has(m)) continue;
      if (!isFree(blocking, m, m + durationMin, dayStart)) continue;
      seen.add(m);
      out.push({ time: hm(m), startMin: m });
    }
  }
  return out.sort((a, b) => a.startMin - b.startMin);
}

export function minLeadStartMin(now: Date, dayStart: Date): number {
  const minNow = minutesInBogota(now) + PUBLIC_MIN_LEAD_MIN;
  const elapsedDays = Math.floor((now.getTime() - dayStart.getTime()) / (24 * 3600 * 1000));
  return elapsedDays > 0 ? 0 : minNow;
}

// ---------- Creación y validación ----------

export type CreateAppointmentInput = {
  barberId: string;
  serviceId: string;
  dateKey: string; // YYYY-MM-DD Bogotá
  startMin: number; // minutos desde 00:00 Bogotá
  clientName: string;
  clientPhone?: string | null;
  clientEmail?: string | null;
  origin: "PUBLIC" | "MANUAL";
  createdById?: string | null;
  notes?: string | null;
  allowPastToday?: boolean; // manual: permite horas ya transcurridas del día actual
};

export type CreateAppointmentResult = { appointment: Appointment; created: boolean; existing?: Appointment };

/**
 * Valida y crea una cita dentro de una transacción, con re-chequeo de
 * solapamiento DENTRO de la transacción (además del mutex de proceso en
 * withBookingLock). Origen público y manual comparten estas reglas (requisito F).
 */
export async function createValidatedAppointment(
  tx: Prisma.TransactionClient,
  input: CreateAppointmentInput
): Promise<Appointment> {
  const service = await tx.service.findUnique({ where: { id: input.serviceId } });
  if (!service || !service.active) throw new ApiError(400, "El servicio no existe o está inactivo");

  const barber = await tx.user.findUnique({ where: { id: input.barberId } });
  if (!barber || barber.role !== "BARBER" || !barber.active) throw new ApiError(400, "El barbero no existe o está inactivo");

  const auth = await tx.barberService.findUnique({
    where: { barberId_serviceId: { barberId: input.barberId, serviceId: input.serviceId } },
  });
  if (!auth || !auth.authorized) throw new ApiError(400, "El barbero no está autorizado para ofrecer este servicio");

  const dayStart = dayStartUtc(input.dateKey);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);
  const startTime = new Date(dayStart.getTime() + input.startMin * 60000);
  const endTime = new Date(startTime.getTime() + service.durationMin * 60000);
  const now = new Date();

  // día válido: hoy o futuro (una cita manual puede ser de hoy con hora ya pasada)
  if (dayStart.getTime() < dayStartUtc(dateKeyInBogota(now)).getTime()) {
    throw new ApiError(400, "No se pueden crear citas en días pasados");
  }
  if (input.origin === "PUBLIC") {
    if (endTime.getTime() < now.getTime() + PUBLIC_MIN_LEAD_MIN * 60000) {
      throw new ApiError(400, "La reserva pública debe tener al menos 15 minutos de anticipación");
    }
  } else if (!input.allowPastToday) {
    if (startTime.getTime() < now.getTime()) {
      throw new ApiError(400, "La hora de la cita debe ser futura");
    }
  }

  // ventana de disponibilidad
  const dow = dayOfWeekInBogota(dayStart);
  const windows = await tx.availability.findMany({
    where: { barberId: input.barberId, dayOfWeek: dow, active: true },
  });
  const startMinDay = input.startMin;
  const endMinDay = startMinDay + service.durationMin;
  const covered = windows.some((w) => {
    const ws = parseHM(w.startTime);
    const we = parseHM(w.endTime);
    return startMinDay >= ws && endMinDay <= we;
  });
  if (!covered) throw new ApiError(400, "La hora no está dentro de la disponibilidad del barbero");

  // solapamiento (la misma validación para público y manual)
  const blocking = await blockingAppointments(tx, input.barberId, dayStart, dayEnd);
  const conflict = blocking.some((b) => overlaps(startTime, endTime, b.startTime, b.endTime));
  if (conflict) throw new ApiError(409, "El horario se cruza con otra cita del barbero");

  const code = await generateUniqueCode(tx);
  return tx.appointment.create({
    data: {
      code,
      barberId: input.barberId,
      serviceId: input.serviceId,
      createdById: input.createdById ?? null,
      origin: input.origin,
      status: "RESERVED",
      clientName: input.clientName.trim(),
      clientPhone: input.clientPhone?.trim() || null,
      clientEmail: input.clientEmail?.trim() || null,
      startTime,
      endTime,
      priceSnapshot: service.price,
      notes: input.notes?.trim() || null,
    },
  });
}

// Mutex de proceso: serializa check+insert para evitar doble reserva concurrente
// (SQLite tiene un único escritor; este candado cierra la carrera en este proceso).
type Job = () => Promise<unknown>;
const globalLock = globalThis as unknown as { __meloBookingQueue?: Promise<unknown> };

export function withBookingLock<T>(job: Job): Promise<T> {
  const prev = globalLock.__meloBookingQueue ?? Promise.resolve();
  const next = prev.then(() => job(), (e) => { throw e; });
  globalLock.__meloBookingQueue = next.catch(() => undefined);
  return next as Promise<T>;
}

export function rescheduleBoundsOK(a: Appointment) {
  return a.status === "RESERVED" || a.status === "CONFIRMED";
}

/**
 * Para reservas "sin preferencia de barbero": elige entre los barberos activos,
 * autorizados para el servicio, con ventana que cubra el intervalo y libres.
 * Balanceo: menor número de citas ese día; desempate alfabético.
 */
export async function pickBarberForAny(
  tx: Prisma.TransactionClient,
  serviceId: string,
  dateKey: string,
  startMin: number,
  durationMin: number
): Promise<string> {
  const dayStart = dayStartUtc(dateKey);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);
  const dow = dayOfWeekInBogota(dayStart);
  const start = new Date(dayStart.getTime() + startMin * 60000);
  const end = new Date(start.getTime() + durationMin * 60000);

  const barbers = await tx.user.findMany({
    where: { role: "BARBER", active: true },
    select: { id: true, name: true },
  });
  if (barbers.length === 0) throw new ApiError(409, "No hay barberos activos");
  const ids = barbers.map((b) => b.id);

  const auths = await tx.barberService.findMany({
    where: { serviceId, authorized: true, barberId: { in: ids } },
    select: { barberId: true },
  });
  const authorizedIds = auths.map((a) => a.barberId);
  if (authorizedIds.length === 0) throw new ApiError(409, "Ningún barbero está autorizado para este servicio");

  const windows = await tx.availability.findMany({
    where: { dayOfWeek: dow, active: true, barberId: { in: authorizedIds } },
  });
  const blockers = await tx.appointment.findMany({
    where: {
      barberId: { in: authorizedIds },
      status: { in: BLOCKING_STATUSES as unknown as string[] },
      startTime: { lt: dayEnd },
      endTime: { gt: dayStart },
    },
    select: { barberId: true, startTime: true, endTime: true },
  });
  const counts = await tx.appointment.groupBy({
    by: ["barberId"],
    where: {
      barberId: { in: authorizedIds },
      status: { in: BLOCKING_STATUSES as unknown as string[] },
      startTime: { gte: dayStart, lt: dayEnd },
    },
    _count: { _all: true },
  });
  const countMap = new Map(counts.map((c) => [c.barberId, c._count._all]));

  const byName = new Map(barbers.map((b) => [b.id, b.name]));
  const candidates: Array<{ id: string; count: number; name: string }> = [];
  for (const id of authorizedIds) {
    const covered = windows.some((w) => {
      if (w.barberId !== id) return false;
      const ws = parseHM(w.startTime);
      const we = parseHM(w.endTime);
      return startMin >= ws && startMin + durationMin <= we;
    });
    if (!covered) continue;
    const busy = blockers.some((b) => b.barberId === id && overlaps(start, end, b.startTime, b.endTime));
    if (busy) continue;
    candidates.push({ id, count: countMap.get(id) ?? 0, name: byName.get(id) ?? "" });
  }
  if (candidates.length === 0) throw new ApiError(409, "Ningún barbero disponible en ese horario");
  candidates.sort((a, b) => a.count - b.count || a.name.localeCompare(b.name));
  return candidates[0].id;
}
