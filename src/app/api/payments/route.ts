import { NextRequest } from "next/server";
import { handle, ok, ApiError, requireFields } from "@/lib/http";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { financeScope } from "@/lib/rbac";
import { audit, snapshot } from "@/lib/audit";
import { notifyFinancialEvent } from "@/lib/notify";
import { dayStartUtc } from "@/lib/time";
import type { Prisma } from "@prisma/client";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const METHODS = ["CASH", "TRANSFER", "CARD", "OTHER"];

/**
 * GET: pagos registrados. Alcance financiero validado en servidor:
 * barbero sin permiso => solo sus citas; con finance.viewOthers => todos (requisito E).
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const barberId = url.searchParams.get("barberId");
    const scope = financeScope(user, barberId);

    const where: Prisma.PaymentWhereInput = {};
    if (from && DATE_RE.test(from)) where.receivedAt = { ...where.receivedAt, gte: dayStartUtc(from) };
    if (to && DATE_RE.test(to)) where.receivedAt = { ...where.receivedAt, lt: new Date(dayStartUtc(to).getTime() + 24 * 3600 * 1000) };
    if (scope.barberId !== "all") {
      where.appointment = { barberId: scope.barberId };
    } else if (barberId) {
      where.appointment = { barberId };
    }

    const payments = await db.payment.findMany({
      where,
      include: {
        appointment: {
          select: { id: true, code: true, clientName: true, priceSnapshot: true, discount: true, barber: { select: { id: true, name: true } }, service: { select: { name: true } } },
        },
        registeredBy: { select: { id: true, name: true } },
      },
      orderBy: { receivedAt: "desc" },
      take: 500,
    });

    return ok({ payments, scope: { restricted: scope.restricted } });
  });
}

/**
 * POST: registrar un pago de una cita COMPLETADA (requisito B: el pago es
 * independiente de la finalización). Idempotente por clientRequestId y
 * con tope de precio-descuento para no contabilizar de más (requisito H.5).
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = (await req.json()) as {
      appointmentId?: string;
      amount?: number;
      method?: string;
      externalRef?: string;
      notes?: string;
      clientRequestId?: string;
    };
    requireFields(body, ["appointmentId", "amount", "method"]);
    const method = body.method!.toUpperCase();
    if (!METHODS.includes(method)) throw new ApiError(400, `Método inválido (use: ${METHODS.join(", ")})`);
    const amount = Math.round(Number(body.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw new ApiError(400, "El monto debe ser mayor que cero");

    const result = await db.$transaction(async (tx) => {
      const appt = await tx.appointment.findUnique({
        where: { id: body.appointmentId! },
        include: { payments: true, service: { select: { name: true } }, barber: { select: { id: true, name: true } } },
      });
      if (!appt) throw new ApiError(404, "Cita no encontrada");
      if (user.role !== "OWNER" && appt.barberId !== user.id) throw new ApiError(403, "Solo puedes registrar pagos de tus propias citas");
      if (appt.status !== "COMPLETED") throw new ApiError(400, "Solo se pueden registrar pagos de citas completadas");

      // idempotencia: el mismo clientRequestId no registra dos veces
      if (body.clientRequestId) {
        const dup = await tx.payment.findUnique({ where: { clientRequestId: body.clientRequestId } });
        if (dup) return { payment: dup, duplicated: true };
      }

      const net = appt.priceSnapshot - appt.discount;
      const sumExisting = appt.payments.reduce((s, p) => s + p.amount, 0);
      if (sumExisting + amount > net) {
        throw new ApiError(400, `El pago excede el valor neto de la cita (neto ${net}, ya registrado ${sumExisting})`);
      }

      const created = await tx.payment.create({
        data: {
          appointmentId: appt.id,
          amount,
          method,
          externalRef: body.externalRef?.trim() || null,
          notes: body.notes?.trim() || null,
          receivedAt: new Date(),
          registeredById: user.id,
          clientRequestId: body.clientRequestId ?? null,
        },
      });
      const payment = await tx.payment.findUnique({
        where: { id: created.id },
        include: { appointment: { select: { code: true, clientName: true, barber: { select: { id: true, name: true } } } } },
      });
      return { payment, duplicated: false };
    });

    await audit({
      entity: "PAYMENT",
      entityId: result.payment.id,
      action: result.duplicated ? "DUPLICATE_IGNORED" : "REGISTER",
      after: snapshot(result.payment),
      user,
    });

    if (!result.duplicated) {
      const p = result.payment;
      const appt = (p as { appointment?: { code: string; clientName: string; barber: { id: string; name: string } } }).appointment;
      await notifyFinancialEvent({
        type: "payment.registered",
        title: "Pago registrado",
        message: `${appt?.code ?? p.appointmentId} · ${appt?.clientName ?? ""} · $ ${p.amount} (${p.method}) · por ${user.name}`,
        barberId: appt?.barber?.id ?? null,
        metadata: { paymentId: p.id },
      });
    }

    return ok({ payment: result.payment, duplicated: result.duplicated }, result.duplicated ? 200 : 201);
  });
}
