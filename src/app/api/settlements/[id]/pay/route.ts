import { NextRequest } from "next/server";
import { handle, ok, ApiError, requireFields } from "@/lib/http";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit, snapshot } from "@/lib/audit";
import { notifyFinancialEvent } from "@/lib/notify";

type Ctx = { params: Promise<{ id: string }> };
const METHODS = ["CASH", "TRANSFER", "CARD", "OTHER"];

/**
 * POST: pagar liquidación aprobada. Marca comisiones como PAID y ajustes como
 * SETTLED. Este es el egreso de caja por comisiones (una sola vez, requisito C).
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    if (user.role !== "OWNER") throw new ApiError(403, "Solo el propietario paga liquidaciones");
    const { id } = await ctx.params;
    const body = (await req.json()) as { method?: string; externalRef?: string };
    requireFields(body, ["method"]);
    const method = body.method!.toUpperCase();
    if (!METHODS.includes(method)) throw new ApiError(400, "Método inválido");

    const result = await db.$transaction(async (tx) => {
      const s = await tx.settlement.findUnique({ where: { id }, include: { items: true, barber: { select: { id: true, name: true } } } });
      if (!s) throw new ApiError(404, "Liquidación no encontrada");
      if (s.status !== "APPROVED") throw new ApiError(400, `La liquidación está ${s.status}; se paga desde APPROVED`);
      const before = { ...s };

      const updated = await tx.settlement.update({
        where: { id },
        data: { status: "PAID", paidAt: new Date(), paymentMethod: method, externalRef: body.externalRef?.trim() || null },
      });

      for (const item of s.items) {
        if (item.commissionId) {
          await tx.commission.update({ where: { id: item.commissionId }, data: { status: "PAID" } });
        }
        if (item.adjustmentId) {
          await tx.commissionAdjustment.update({ where: { id: item.adjustmentId }, data: { status: "SETTLED" } });
        }
      }
      return { before, after: updated, barberId: s.barberId, barberName: s.barber.name, itemCount: s.items.length };
    });

    await audit({ entity: "SETTLEMENT", entityId: id, action: "PAY", before: snapshot(result.before), after: snapshot(result.after), user });
    await notifyFinancialEvent({
      type: "settlement.paid",
      title: "Liquidación pagada",
      message: `${result.after.code} · ${result.barberName} · pagado ${result.after.totalAmount} (${method}) · ${result.itemCount} ítems`,
      barberId: result.barberId,
      metadata: { settlementId: id },
    });
    return ok({ settlement: result.after });
  });
}
