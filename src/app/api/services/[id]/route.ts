import { NextRequest } from "next/server";
import { handle, ok, ApiError, requireFields } from "@/lib/http";
import { db } from "@/lib/db";
import { requireOwner } from "@/lib/auth";
import { audit, snapshot } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const user = await requireOwner();
    const { id } = await ctx.params;
    const body = (await req.json()) as {
      name?: string;
      description?: string;
      price?: number;
      durationMin?: number;
      active?: boolean;
      sortOrder?: number;
    };
    const existing = await db.service.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "Servicio no encontrado");
    if (body.price !== undefined && body.price <= 0) throw new ApiError(400, "Precio inválido");
    if (body.durationMin !== undefined && (body.durationMin < 10 || body.durationMin > 300)) throw new ApiError(400, "Duración inválida");

    // Nota (requisito C/H.9): cambiar el precio aquí NO altera el precio copiado
    // de citas históricas (priceSnapshot) ni las comisiones ya generadas.
    const updated = await db.service.update({
      where: { id },
      data: {
        name: body.name?.trim() ?? existing.name,
        description: body.description?.trim() ?? existing.description,
        price: body.price !== undefined ? Math.round(body.price) : existing.price,
        durationMin: body.durationMin !== undefined ? Math.round(body.durationMin) : existing.durationMin,
        active: body.active ?? existing.active,
        sortOrder: body.sortOrder ?? existing.sortOrder,
      },
    });
    await audit({ entity: "SERVICE", entityId: id, action: "UPDATE", before: snapshot(existing), after: snapshot(updated), user });
    return ok({ service: updated });
  });
}
