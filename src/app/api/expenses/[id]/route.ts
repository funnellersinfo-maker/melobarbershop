import { NextRequest } from "next/server";
import { handle, ok, ApiError } from "@/lib/http";
import { db } from "@/lib/db";
import { requireOwner } from "@/lib/auth";
import { audit, snapshot } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const user = await requireOwner();
    const { id } = await ctx.params;
    const body = (await req.json()) as { description?: string; category?: string; amount?: number; notes?: string; method?: string };
    const existing = await db.expense.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "Gasto no encontrado");
    if (body.amount !== undefined && (!Number.isFinite(body.amount) || body.amount <= 0)) throw new ApiError(400, "Monto inválido");
    const updated = await db.expense.update({
      where: { id },
      data: {
        description: body.description?.trim() ?? existing.description,
        category: body.category ?? existing.category,
        amount: body.amount !== undefined ? Math.round(body.amount) : existing.amount,
        method: body.method?.toUpperCase() ?? existing.method,
        notes: body.notes?.trim() ?? existing.notes,
      },
    });
    await audit({ entity: "EXPENSE", entityId: id, action: "UPDATE", before: snapshot(existing), after: snapshot(updated), user });
    return ok({ expense: updated });
  });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const user = await requireOwner();
    const { id } = await ctx.params;
    const existing = await db.expense.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "Gasto no encontrado");
    await db.expense.delete({ where: { id } });
    await audit({ entity: "EXPENSE", entityId: id, action: "DELETE", before: snapshot(existing), user });
    return ok({ deleted: true });
  });
}
