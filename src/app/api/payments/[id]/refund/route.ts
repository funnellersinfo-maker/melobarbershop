import { NextRequest } from "next/server";
import { handle, ok, ApiError, requireFields } from "@/lib/http";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit, snapshot } from "@/lib/audit";
import { notifyFinancialEvent } from "@/lib/notify";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/payments/:id/refund — devolución (parcial o total) de un pago.
 * El dinero devuelto reduce el cobrado; NO toca automáticamente la comisión del
 * barbero (eso se hace como ajuste explícito con motivo, requisito C).
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    if (user.role !== "OWNER") throw new ApiError(403, "Solo el propietario registra devoluciones");
    const { id } = await ctx.params;
    const body = (await req.json()) as { amount?: number; reason?: string };
    requireFields(body, ["amount", "reason"]);
    const amount = Math.round(Number(body.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw new ApiError(400, "El monto a devolver debe ser mayor que cero");

    const result = await db.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id }, include: { appointment: { select: { code: true, barberId: true, clientName: true } } } });
      if (!payment) throw new ApiError(404, "Pago no encontrado");
      const pending = payment.amount - payment.refundedAmount;
      if (amount > pending) throw new ApiError(400, `Máximo devoluble: ${pending}`);

      const refundedAmount = payment.refundedAmount + amount;
      const status = refundedAmount >= payment.amount ? "REFUNDED" : "PARTIALLY_REFUNDED";
      const updated = await tx.payment.update({
        where: { id },
        data: { refundedAmount, status, refundReason: body.reason?.trim() ?? payment.refundReason },
      });
      return { before: payment, after: updated, code: payment.appointment.code, barberId: payment.appointment.barberId };
    });

    await audit({
      entity: "PAYMENT",
      entityId: id,
      action: "REFUND",
      before: snapshot(result.before),
      after: snapshot(result.after),
      user,
    });
    await notifyFinancialEvent({
      type: "payment.refunded",
      title: "Devolución registrada",
      message: `${result.code} · devolución de ${amount} · motivo: ${body.reason?.trim()}`,
      barberId: result.barberId,
      metadata: { paymentId: id },
    });
    return ok({ payment: result.after });
  });
}
