"use client";
// MELO BARBERSHOP — invitaciones de registro.
// La app es 100% estática (sin backend), así que el código de invitación es
// DETERMINISTA: se deriva matemáticamente del correo normalizado. El dueño
// genera el código en su panel, y la validación en el navegador del prospecto
// recalcula el mismo código a partir del correo ingresado: si coinciden,
// el acceso se desbloquea. No requiere sincronización entre dispositivos.

import { cuid } from "@/lib/store";

export const INVITES_KEY = "melo.invites.v1";
const INVITE_SECRET = "MELO-BARBER-XP-2026";
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // sin caracteres confusos (0/O, 1/I/L)

export type InviteRecord = {
  id: string;
  email: string;
  code: string;
  createdAt: string;
};

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(raw: string): boolean {
  const e = normalizeEmail(raw);
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
}

/** Código único y estable para un correo (mismo correo ⇒ mismo código, siempre). */
export function invitationCodeForEmail(raw: string): string {
  const email = normalizeEmail(raw);
  const h1 = fnv1a(`${email}|${INVITE_SECRET}`);
  const h2 = fnv1a(`${INVITE_SECRET}|${email}|v2`);
  let code = "";
  for (let i = 0; i < 4; i++) code += ALPHABET[(h1 >>> (i * 5)) & 31];
  for (let i = 0; i < 4; i++) code += ALPHABET[(h2 >>> (i * 5)) & 31];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** El correo y el código deben coincidir (se recalcula y compara). */
export function validateInvitation(rawEmail: string, rawCode: string): boolean {
  if (!isValidEmail(rawEmail)) return false;
  const expected = invitationCodeForEmail(rawEmail);
  const given = rawCode.trim().toUpperCase().replace(/\s+/g, "").replace(/-/g, "");
  const target = expected.replace(/-/g, "");
  return given === target || given === expected;
}

// ---------- registro local de invitaciones (panel del dueño) ----------
function readAll(): InviteRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(INVITES_KEY);
    return raw ? (JSON.parse(raw) as InviteRecord[]) : [];
  } catch {
    return [];
  }
}

function writeAll(list: InviteRecord[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(INVITES_KEY, JSON.stringify(list));
  window.dispatchEvent(new CustomEvent("melo:db-changed", { detail: INVITES_KEY }));
}

export function getInvites(): InviteRecord[] {
  return readAll().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function addInvite(rawEmail: string): InviteRecord {
  const email = normalizeEmail(rawEmail);
  const list = readAll();
  const existing = list.find((i) => i.email === email);
  if (existing) return existing; // el código no cambia: es el mismo para ese correo
  const rec: InviteRecord = { id: cuid("inv"), email, code: invitationCodeForEmail(email), createdAt: new Date().toISOString() };
  list.push(rec);
  writeAll(list);
  return rec;
}

export function removeInvite(id: string) {
  writeAll(readAll().filter((i) => i.id !== id));
}
