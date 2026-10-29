import { NextRequest } from "next/server";
import { handle, ok, ApiError, requireFields } from "@/lib/http";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit, snapshot } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PUT /api/workers/:id/services  body: { authorizations: [{serviceId, authorized}] }
 * Define qué servicios puede ofrecer cada barbero (requisito E).
 * GET: consulta (propietario o el propio barbero).
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    if (user.role !== "OWNER" && user.id !== id) throw new ApiError(403, "Sin permiso para consultar estos servicios");
    const rows = await db.barberService.findMany({
      where: { barberId: id },
      include: { service: { select: { id: true, name: true, active: true, price: true } } },
      orderBy: { service: { sortOrder: "asc" } },
    });
    return ok({ authorizations: rows.map((r) => ({ serviceId: r.serviceId, authorized: r.authorized, service: r.service })) });
  });
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    if (user.role !== "OWNER") throw new ApiError(403, "Solo el propietario gestiona las autorizaciones de servicios");
    const body = (await req.json()) as { authorizations?: Array<{ serviceId?: string; authorized?: boolean }> };
    requireFields(body, ["authorizations"]);
    if (!Array.isArray(body.authorizations)) throw new ApiError(400, "authorizations debe ser una lista");

    const before = await db.barberService.findMany({ where: { barberId: id } });
    const result = await db.$transaction(async (tx) => {
      const out: Array<{ serviceId: string; authorized: boolean }> = [];
      for (const a of body.authorizations!) {
        if (!a.serviceId) continue;
        const svc = await tx.service.findUnique({ where: { id: a.serviceId } });
        if (!svc) continue;
        const row = await tx.barberService.upsert({
          where: { barberId_serviceId: { barberId: id, serviceId: a.serviceId } },
          update: { authorized: !!a.authorized },
          create: { barberId: id, serviceId: a.serviceId, authorized: !!a.authorized },
        });
        out.push({ serviceId: row.serviceId, authorized: row.authorized });
      }
      return out;
    });
    await audit({ entity: "BARBER_SERVICE", entityId: id, action: "SET_AUTHORIZATIONS", before: snapshot(before), after: snapshot(result), user });
    return ok({ authorizations: result });
  });
}
