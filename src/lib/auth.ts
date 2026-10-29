// Sesiones (cookie httpOnly + tabla Session) y verificación de contraseñas.
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { randomToken } from "@/lib/password";
import { verifyPassword } from "@/lib/password";
import { ApiError } from "@/lib/http";
import type { User } from "@prisma/client";

export const SESSION_COOKIE = "melo_session";
const SESSION_DAYS = 7;

export type SessionUser = User;

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
  await db.session.create({ data: { token, userId, expiresAt } });
  return { token, expiresAt };
}

export async function destroySession(token: string | undefined) {
  if (token) await db.session.deleteMany({ where: { token } });
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({ where: { token }, include: { user: true } });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  if (!session.user.active) return null;
  return session.user;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new ApiError(401, "No autenticado");
  return user;
}

export async function requireOwner(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "OWNER") throw new ApiError(403, "Solo el propietario puede realizar esta acción");
  return user;
}

export async function login(email: string, password: string) {
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || !user.active) throw new ApiError(401, "Credenciales inválidas o usuario inactivo");
  if (!verifyPassword(password, user.passwordHash)) throw new ApiError(401, "Credenciales inválidas");
  return createSession(user.id);
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  };
}
