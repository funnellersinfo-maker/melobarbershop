// Control de acceso por roles y permisos excepcionales (validado SIEMPRE en el servidor).
import { ApiError } from "@/lib/http";
import type { User } from "@prisma/client";

export const PERMISSION_KEYS = [
  "finance.viewOthers",
  "schedule.manageOwn",
  "settlements.approveOwn",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  "finance.viewOthers": "Ver la información financiera de otros barberos",
  "schedule.manageOwn": "Editar su propia disponibilidad semanal",
  "settlements.approveOwn": "Aprobar sus propias liquidaciones",
};

export function parsePermissions(user: Pick<User, "permissions">): Partial<Record<PermissionKey, boolean>> {
  try {
    return JSON.parse(user.permissions || "{}");
  } catch {
    return {};
  }
}

export function can(user: User, key: PermissionKey): boolean {
  if (user.role === "OWNER") return true;
  return !!parsePermissions(user)[key];
}

export function assertCan(user: User, key: PermissionKey, msg?: string) {
  if (!can(user, key)) throw new ApiError(403, msg || `Permiso requerido: ${PERMISSION_LABELS[key]}`);
}

export function isOwner(user: User): boolean {
  return user.role === "OWNER";
}

export function assertOwner(user: User, msg = "Acción exclusiva del propietario") {
  if (user.role !== "OWNER") throw new ApiError(403, msg);
}

/**
 * Alcance de consulta financiera:
 * - OWNER: cualquier barbero.
 * - BARBER con finance.viewOthers: cualquier barbero (permiso excepcional).
 * - BARBER sin permiso: solo él mismo (nunca confía en el filtro del cliente).
 */
export function financeScope(user: User, requestedBarberId?: string | null): { barberId: string; restricted: boolean } {
  if (user.role === "OWNER") return { barberId: requestedBarberId ?? "all", restricted: false };
  if (can(user, "finance.viewOthers")) return { barberId: requestedBarberId ?? "all", restricted: false };
  // sin permiso: se ignora el filtro solicitado y se fuerza el propio id
  return { barberId: user.id, restricted: true };
}

export function sanitizeUser(u: User) {
  const { passwordHash, ...rest } = (u as unknown as Record<string, unknown>) as User & { passwordHash?: string };
  return {
    id: rest.id,
    email: rest.email,
    name: rest.name,
    phone: rest.phone,
    role: rest.role,
    active: rest.active,
    permissions: parsePermissions(rest),
    notifyInternal: rest.notifyInternal,
    notifyWhatsapp: rest.notifyWhatsapp,
    createdAt: rest.createdAt,
  };
}
