import { NextRequest } from "next/server";
import { handle, ok, ApiError, requireFields } from "@/lib/http";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit, snapshot } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

const HM_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

/**
 * GET: disponibilidad semanal (propietario o propio barbero).
 * PUT: reemplazo completo de ventanas. Propietario siempre; barbero solo con
 * permiso excepcional schedule.manageOwn (requisito E, validado en servidor).
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    if (user.role !== "OWNER" && user.id !== id) throw new ApiError(403, "Sin permiso para consultar esta disponibilidad");
    const availability = await db.availability.findMany({ where: { barberId: id }, orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }] });
    return ok({ availability, canEdit: user.role === "OWNER" || can(user, "schedule.manageOwn") });
  });
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const isSelf = user.id === id;
    if (user.role !== "OWNER") {
      if (!isSelf || !can(user, "schedule.manageOwn")) {
        throw new ApiError(403, "Necesitas el permiso del propietario para editar tu disponibilidad");
      }
    }

    const body = (await req.json()) as { windows?: Array<{ dayOfWeek?: number; startTime?: string; endTime?: string }> };
    requireFields(body, ["windows"]);
    if (!Array.isArray(body.windows)) throw new ApiError(400, "windows debe ser una lista");
    for (const w of body.windows!) {
      if (w.dayOfWeek === undefined || w.dayOfWeek < 0 || w.dayOfWeek > 6) throw new ApiError(400, "dayOfWeek entre 0 y 6");
      if (!w.startTime || !HM_RE.test(w.startTime)) throw new ApiError(400, "startTime HH:MM inválido");
      if (!w.endTime || !HM_RE.test(w.endTime)) throw new ApiError(400, "endTime HH:MM inválido");
      if (w.startTime >= w.endTime) throw new ApiError(400, "La ventana debe terminar después de empezar");
      const sameDay = body.windows!.filter((x) => x.dayOfWeek === w.dayOfWeek);
      if (sameDay.length > 4) throw new ApiError(400, "Máximo 4 ventanas por día");
    }

    const before = await db.availability.findMany({ where: { barberId: id } });
    const result = await db.$transaction(async (tx) => {
      await tx.availability.deleteMany({ where: { barberId: id } });
      const created: Array<{ dayOfWeek: number; startTime: string; endTime: string }> = [];
      for (const w of body.windows!) {
        const row = await tx.availability.create({
          data: { barberId: id, dayOfWeek: w.dayOfWeek!, startTime: w.startTime!, endTime: w.endTime!, active: true },
        });
        created.push({ dayOfWeek: row.dayOfWeek, startTime: row.startTime, endTime: row.endTime });
      }
      return created;
    });
    await audit({ entity: "AVAILABILITY", entityId: id, action: "SET", before: snapshot(before), after: snapshot(result), user });
    return ok({ availability: result });
  });
}
