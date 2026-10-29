import { NextRequest } from "next/server";
import { handle, ok, ApiError, requireFields } from "@/lib/http";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { can, isOwner } from "@/lib/rbac";
import { createValidatedAppointment, withBookingLock } from "@/lib/booking";
import { dayStartUtc, parseHM, timeHMInBogota, fmtDateMedium, dayRange } from "@/lib/time";
import { audit } from "@/lib/audit";
import { notifyBarberAndOwner } from "@/lib/notify";
import type { Prisma } from "@prisma/client";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

/**
 * GET: lista de citas. El barbero ve el calendario completo (operativo) pero
 * SIN datos financieros ajenos: pagos y comisiones de otros se omiten a menos
 * que tenga el permiso excepcional finance.viewOthers (requisito E).
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const url = new URL(req.url);
    const date = url.searchParams.get("date"); // YYYY-MM-DD (día exacto)
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const barberId = url.searchParams.get("barberId");
    const status = url.searchParams.get("status");
    const origin = url.searchParams.get("origin");

    const where: Prisma.AppointmentWhereInput = {};
    if (date && DATE_RE.test(date)) {
      const r = dayRange(date);
      where.startTime = { gte: r.from, lt: r.to };
    } else if (from || to) {
      where.startTime = {};
      if (from && DATE_RE.test(from)) where.startTime.gte = dayStartUtc(from);
      if (to && DATE_RE.test(to)) where.startTime.lt = new Date(dayStartUtc(to).getTime() + 24 * 3600 * 1000);
    }
    if (barberId) where.barberId = barberId;
    if (status) where.status = status;
    if (origin) where.origin = origin;

    const rows = await db.appointment.findMany({
      where,
      include: {
        barber: { select: { id: true, name: true } },
        service: { select: { id: true, name: true, durationMin: true } },
        creator: { select: { id: true, name: true } },
        payments: { select: { amount: true, refundedAmount: true, method: true } },
        commission: { select: { status: true, calculatedAmount: true, configured: true } },
      },
      orderBy: { startTime: "asc" },
      take: 500,
    });

    const viewOthers = isOwner(user) || can(user, "finance.viewOthers");
    const appointments = rows.map((a) => {
      const own = a.barberId === user.id;
      const showFinancial = own || viewOthers;
      const pagado = a.payments.reduce((s, p) => s + (p.amount - p.refundedAmount), 0);
      return {
        id: a.id,
        code: a.code,
        status: a.status,
        origin: a.origin,
        startTime: a.startTime,
        endTime: a.endTime,
        clientName: a.clientName,
        clientPhone: own || isOwner(user) ? a.clientPhone : a.clientPhone ? "***" : null,
        clientEmail: own || isOwner(user) ? a.clientEmail : null,
        notes: a.notes,
        cancelReason: a.cancelReason,
        completedAt: a.completedAt,
        createdAt: a.createdAt,
        barber: a.barber,
        service: a.service,
        creator: a.creator ? { id: a.creator.id, name: a.creator.name } : { id: null, name: "Web pública" },
        priceSnapshot: a.priceSnapshot,
        discount: a.discount,
        financial: showFinancial
          ? {
              pagado,
              pendiente: Math.max(0, a.priceSnapshot - a.discount - pagado),
              commission: a.commission
                ? { status: a.commission.status, amount: a.commission.calculatedAmount, configured: a.commission.configured }
                : null,
            }
          : null,
      };
    });

    return ok({ appointments });
  });
}

/**
 * POST: cita manual (presencial/teléfono/otros canales) desde el calendario interno.
 * El propietario crea para cualquier barbero; el barbero solo para sí mismo.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = (await req.json()) as {
      barberId?: string;
      serviceId?: string;
      date?: string;
      time?: string;
      clientName?: string;
      clientPhone?: string;
      clientEmail?: string;
      notes?: string;
      allowPastToday?: boolean;
    };
    requireFields(body, ["barberId", "serviceId", "date", "time", "clientName"]);
    if (!DATE_RE.test(body.date!)) throw new ApiError(400, "date debe ser YYYY-MM-DD");
    if (!TIME_RE.test(body.time!)) throw new ApiError(400, "time debe ser HH:MM");

    let barberId = body.barberId!;
    if (user.role !== "OWNER") {
      if (barberId !== user.id) throw new ApiError(403, "Solo puedes crear citas para ti mismo");
    }

    const service = await db.service.findUnique({ where: { id: body.serviceId! } });
    if (!service || !service.active) throw new ApiError(404, "Servicio no encontrado o inactivo");

    const startMin = parseHM(body.time!);
    const created = await withBookingLock(() =>
      db.$transaction((tx) =>
        createValidatedAppointment(tx, {
          barberId,
          serviceId: body.serviceId!,
          dateKey: body.date!,
          startMin,
          clientName: body.clientName!,
          clientPhone: body.clientPhone ?? null,
          clientEmail: body.clientEmail ?? null,
          origin: "MANUAL",
          createdById: user.id,
          notes: body.notes ?? null,
          allowPastToday: !!body.allowPastToday,
        })
      )
    );

    await audit({ entity: "APPOINTMENT", entityId: created.id, action: "CREATE_MANUAL", after: created, user });
    await notifyBarberAndOwner(
      created.barberId,
      {
        type: "appointment.created",
        title: "Nueva cita manual",
        message: `${service.name} · ${created.clientName} · ${fmtDateMedium(created.startTime)} ${timeHMInBogota(created.startTime)} · registrada por ${user.name}`,
        metadata: { key: `${created.id}:created-manual`, appointmentId: created.id },
      },
      `MELO BARBERSHOP: cita registrada para ti: ${service.name} · ${created.clientName} · ${fmtDateMedium(created.startTime)} ${timeHMInBogota(created.startTime)}.`
    );

    return ok({ appointment: created }, 201);
  });
}
