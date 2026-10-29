// Utilidades de tiempo para la zona America/Bogota (UTC-5 fijo, Colombia sin DST).
// Isoformas: cliente y servidor usan las mismas funciones (sin dependencia de Intl).
export const TZ = "America/Bogota";
const OFFSET_MS = 5 * 60 * 60 * 1000;

export const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
export const DIAS_CORTOS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
export const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export const pad2 = (n: number) => String(n).padStart(2, "0");

export function partsInBogota(d: Date) {
  const s = new Date(d.getTime() - OFFSET_MS); // reloj de pared en Bogotá
  return {
    year: s.getUTCFullYear(),
    month: s.getUTCMonth() + 1,
    day: s.getUTCDate(),
    hours: s.getUTCHours(),
    minutes: s.getUTCMinutes(),
    dow: s.getUTCDay(),
  };
}

export function dateKeyInBogota(d: Date): string {
  const p = partsInBogota(d);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

export function timeHMInBogota(d: Date): string {
  const p = partsInBogota(d);
  return `${pad2(p.hours)}:${pad2(p.minutes)}`;
}

export function minutesInBogota(d: Date): number {
  const p = partsInBogota(d);
  return p.hours * 60 + p.minutes;
}

export function dayOfWeekInBogota(d: Date): number {
  return new Date(d.getTime() - OFFSET_MS).getUTCDay();
}

// "2026-10-30" + "10:00" (o "10:00:30") -> Date UTC equivalente en Bogotá
export function bogotaToUtc(dateKey: string, timeStr: string): Date {
  const t = timeStr.length === 5 ? `${timeStr}:00` : timeStr;
  return new Date(`${dateKey}T${t}-05:00`);
}

export function dayStartUtc(dateKey: string): Date {
  return bogotaToUtc(dateKey, "00:00");
}
export function dayEndUtc(dateKey: string): Date {
  return new Date(bogotaToUtc(dateKey, "00:00").getTime() + 24 * 3600 * 1000);
}

export function parseHM(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function hm(min: number): string {
  return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
}

export function fmtDateLong(d: Date): string {
  const p = partsInBogota(d);
  return `${DIAS[dayOfWeekInBogota(d)]} ${p.day} de ${MESES[p.month - 1]} de ${p.year}`;
}

export function fmtDateMedium(d: Date): string {
  const p = partsInBogota(d);
  return `${p.day} ${MESES_CORTOS[p.month - 1]} ${p.year}`;
}

export function fmtDateShort(d: Date): string {
  const p = partsInBogota(d);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

export function fmtTime(d: Date): string {
  return timeHMInBogota(d);
}

export function fmtDateTime(d: Date): string {
  return `${fmtDateMedium(d)}, ${timeHMInBogota(d)}`;
}

export function addDaysKey(dateKey: string, days: number): string {
  const d = dayStartUtc(dateKey);
  const nd = new Date(d.getTime() + days * 24 * 3600 * 1000);
  return dateKeyInBogota(nd);
}

// ISO "YYYY-MM-DD" -> {from,to} UTC cubriendo ese día Bogotá
export function dayRange(dateKey: string) {
  return { from: dayStartUtc(dateKey), to: dayEndUtc(dateKey) };
}

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

export function todayKey(): string {
  return dateKeyInBogota(new Date());
}
