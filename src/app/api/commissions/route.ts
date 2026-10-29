import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/http";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { financeScope } from "@/lib/rbac";
import { dayStartUtc } from "@/lib/time";
import type { Prisma } from "@prisma/client";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET: comisiones generadas (con su copia histórica).
 * Barberos: solo las propias, o las de otros si tienen finance.viewOthers.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const barberId = url.searchParams.get("barberId");
    const status = url.searchParams.get("status");
    const scope = financeScope(user, barberId);

    const where: Prisma.CommissionWhereInput = {};
    if (from && DATE_RE.test(from)) where.createdAt = { ...where.createdAt, gte: dayStartUtc(from) };
    if (to && DATE_RE.test(to)) where.createdAt = { ...where.createdAt, lt: new Date(dayStartUtc(to).getTime() + 24 * 3600 * 1000) };
    if (status) where.status = status;
    if (scope.barberId !== "all") where.barberId = scope.barberId;
    else if (barberId) where.barberId = barberId;

    const commissions = await db.commission.findMany({
      where,
      include: {
        barber: { select: { id: true, name: true } },
        appointment: {
          select: {
            id: true,
            code: true,
            clientName: true,
            completedAt: true,
            priceSnapshot: true,
            discount: true,
            service: { select: { name: true } },
            barber: { select: { id: true, name: true } },
            payments: { select: { amount: true, refundedAmount: true } },
          },
        },
        settlementItems: { select: { settlement: { select: { id: true, code: true, status: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });

    const rows = commissions.map((c) => {
      const pagadoAppt = c.appointment.payments.reduce((s, p) => s + (p.amount - p.refundedAmount), 0);
      return {
        ...c,
        snapshot: (() => {
          try {
            return JSON.parse(c.snapshotJson);
          } catch {
            return null;
          }
        })(),
        appointment: {
          ...c.appointment,
          payments: undefined,
          pagado: pagadoAppt,
          pendiente: Math.max(0, c.appointment.priceSnapshot - c.appointment.discount - pagadoAppt),
        },
      };
    });

    return ok({ commissions: rows });
  });
}
