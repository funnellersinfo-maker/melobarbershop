import { NextRequest } from "next/server";
import { handle, ok, ApiError } from "@/lib/http";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit, snapshot } from "@/lib/audit";
import { notifyFinancialEvent } from "@/lib/notify";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST: aprobar liquidación. Solo el propietario, o el propio barbero si tiene
 * el permiso excepcional settlements.approveOwn (requisito E, validado en servidor).
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;

    const result = await db.$transaction(async (tx) => {
      const s = await tx.settlement.findUnique({ where: { id }, include: { barber: { select: { id: true, name: true } } } });
      if (!s) throw new ApiError(404, "Liquidación no encontrada");
      if (s.status !== "DRAFT") throw new ApiError(400, `La liquidación está ${s.status}; solo se aprueban borradores`);

      if (user.role !== "OWNER") {
        const allowed = can(user, "settlements.approveOwn") && s.barberId === user.id;
        if (!allowed) throw new ApiError(403, "No puedes aprobar esta liquidación");
      }

      const before = { ...s };
      const updated = await tx.settlement.update({
        where: { id },
        data: { status: "APPROVED", approvedById: user.id, approvedAt: new Date() },
      });
      return { before, after: updated, barberId: s.barberId, barberName: s.barber.name };
    });

    await audit({ entity: "SETTLEMENT", entityId: id, action: "APPROVE", before: snapshot(result.before), after: snapshot(result.after), user });
    await notifyFinancialEvent({
      type: "settlement.approved",
      title: "Liquidación aprobada",
      message: `${result.after.code} · ${result.barberName} · total ${result.after.totalAmount} · aprobada por ${user.name}`,
      barberId: result.barberId,
      metadata: { settlementId: id },
    });
    return ok({ settlement: result.after });
  });
}
