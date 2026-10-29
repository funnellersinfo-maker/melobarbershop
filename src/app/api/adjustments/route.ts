import { NextRequest } from "next/server";
import { handle, ok, ApiError, requireFields } from "@/lib/http";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { financeScope } from "@/lib/rbac";
import { audit, snapshot } from "@/lib/audit";
import { notifyFinancialEvent } from "@/lib/notify";

/**
 * GET: ajustes (anticipos / devoluciones / manuales) pendientes e históricos.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const url = new URL(req.url);
    const barberId = url.searchParams.get("barberId");
    const status = url.searchParams.get("status");
    const scope = financeScope(user, barberId);
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (scope.barberId !== "all") where.barberId = scope.barberId;
    else if (barberId) where.barberId = barberId;

    const adjustments = await db.commissionAdjustment.findMany({
      where,
      include: { barber: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 300,
    });
    return ok({ adjustments });
  });
}

/**
 * POST: registrar ajuste (requisito C). Anticipos y devoluciones se guardan con
 * signo negativo (restan en la liquidación); los manuales con el signo dado.
 * Siempre con motivo y auditoría. Solo el propietario.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    if (user.role !== "OWNER") throw new ApiError(403, "Solo el propietario registra ajustes");
    const body = (await req.json()) as {
      barberId?: string;
      type?: "ADVANCE" | "REFUND" | "MANUAL";
      amount?: number;
      reason?: string;
      appointmentId?: string;
    };
    requireFields(body, ["barberId", "type", "amount", "reason"]);
    const TYPES = ["ADVANCE", "REFUND", "MANUAL"];
    if (!TYPES.includes(body.type!)) throw new ApiError(400, "type inválido");
    const rawAmount = Math.round(Number(body.amount));
    if (!Number.isFinite(rawAmount) || rawAmount === 0) throw new ApiError(400, "El monto debe ser distinto de cero");
    if (body.type !== "MANUAL" && rawAmount < 0) throw new ApiError(400, "Registre el monto positivo; el signo lo aplica el sistema");

    let appointmentCode: string | null = null;
    if (body.appointmentId) {
      const appt = await db.appointment.findUnique({ where: { id: body.appointmentId }, select: { code: true, barberId: true } });
      if (appt && appt.barberId === body.barberId) appointmentCode = appt.code;
    }

    const signed = body.type === "MANUAL" ? rawAmount : -Math.abs(rawAmount);
    const adjustment = await db.commissionAdjustment.create({
      data: {
        barberId: body.barberId!,
        type: body.type!,
        amount: signed,
        reason: body.reason!.trim(),
        appointmentId: body.appointmentId ?? null,
        appointmentCode,
        status: "PENDING",
        createdById: user.id,
      },
    });

    await audit({ entity: "ADJUSTMENT", entityId: adjustment.id, action: "CREATE", after: snapshot(adjustment), user });
    await notifyFinancialEvent({
      type: "adjustment.created",
      title: `Ajuste registrado (${body.type})`,
      message: `${body.reason!.trim()} · efecto ${signed} en la próxima liquidación · por ${user.name}`,
      barberId: body.barberId!,
      metadata: { adjustmentId: adjustment.id },
    });
    return ok({ adjustment }, 201);
  });
}
