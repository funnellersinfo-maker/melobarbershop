import { NextRequest } from "next/server";
import { handle, ok, ApiError } from "@/lib/http";
import { db } from "@/lib/db";
import { requireOwner } from "@/lib/auth";
import { PERMISSION_KEYS, parsePermissions, sanitizeUser } from "@/lib/rbac";
import { hashPassword } from "@/lib/password";
import { audit, snapshot } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH: datos del barbero, estado, credenciales y PERMISOS EXCEPCIONALES.
 * Los permisos se validan en servidor en cada uso (nunca se confía en el cliente).
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const user = await requireOwner();
    const { id } = await ctx.params;
    const body = (await req.json()) as {
      name?: string;
      phone?: string;
      active?: boolean;
      password?: string;
      notifyInternal?: boolean;
      notifyWhatsapp?: boolean;
      permissions?: Record<string, boolean>;
    };
    const existing = await db.user.findUnique({ where: { id } });
    if (!existing || existing.role !== "BARBER") throw new ApiError(404, "Barbero no encontrado");

    // permisos: solo claves conocidas, guardados como JSON
    let permissionsJson = existing.permissions;
    if (body.permissions) {
      const current = parsePermissions(existing);
      const next: Record<string, boolean> = { ...current };
      for (const key of PERMISSION_KEYS) {
        if (typeof body.permissions[key] === "boolean") next[key] = body.permissions[key]!;
      }
      permissionsJson = JSON.stringify(next);
    }

    const updated = await db.user.update({
      where: { id },
      data: {
        name: body.name?.trim() ?? existing.name,
        phone: body.phone?.trim() ?? existing.phone,
        active: body.active ?? existing.active,
        notifyInternal: body.notifyInternal ?? existing.notifyInternal,
        notifyWhatsapp: body.notifyWhatsapp ?? existing.notifyWhatsapp,
        permissions: permissionsJson,
        passwordHash: body.password ? (body.password.length < 6 ? (() => { throw new ApiError(400, "La contraseña debe tener al menos 6 caracteres"); })() : hashPassword(body.password)) : existing.passwordHash,
      },
    });

    await audit({
      entity: "USER",
      entityId: id,
      action: "UPDATE_BARBER",
      before: snapshot(sanitizeUser(existing)),
      after: snapshot(sanitizeUser(updated)),
      user,
    });
    return ok({ worker: sanitizeUser(updated) });
  });
}
