import { NextRequest } from "next/server";
import { handle, ok, ApiError, requireFields } from "@/lib/http";
import { db } from "@/lib/db";
import { requireOwner } from "@/lib/auth";
import { PERMISSION_KEYS, sanitizeUser } from "@/lib/rbac";
import { hashPassword } from "@/lib/password";
import { audit, snapshot } from "@/lib/audit";

/**
 * GET: equipo (barberos) con permisos, autorizaciones y reglas vigentes.
 */
export async function GET(_req: NextRequest) {
  return handle(async () => {
    await requireOwner();
    const workers = await db.user.findMany({
      where: { role: "BARBER" },
      orderBy: { name: "asc" },
      include: {
        barberServices: { include: { service: { select: { id: true, name: true, active: true } } } },
        availability: true,
      },
    });
    return ok({
      workers: workers.map((w) => ({
        ...sanitizeUser(w),
        barberServices: w.barberServices,
        availability: w.availability,
      })),
      permissionKeys: PERMISSION_KEYS,
    });
  });
}

/**
 * POST: crear barbero. El propietario define la contraseña inicial.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireOwner();
    const body = (await req.json()) as { name?: string; email?: string; phone?: string; password?: string };
    requireFields(body, ["name", "email", "password"]);
    const email = body.email!.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiError(400, "Correo inválido");
    if (body.password!.length < 6) throw new ApiError(400, "La contraseña debe tener al menos 6 caracteres");
    const exists = await db.user.findUnique({ where: { email } });
    if (exists) throw new ApiError(409, "Ya existe un usuario con ese correo");

    const worker = await db.user.create({
      data: {
        name: body.name!.trim(),
        email,
        phone: body.phone?.trim() || null,
        passwordHash: hashPassword(body.password!),
        role: "BARBER",
        permissions: "{}",
      },
    });
    await audit({ entity: "USER", entityId: worker.id, action: "CREATE_BARBER", after: snapshot(sanitizeUser(worker)), user });
    return ok({ worker: sanitizeUser(worker) }, 201);
  });
}
