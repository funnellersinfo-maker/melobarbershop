import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/http";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { todayKey, dayRange, dayStartUtc } from "@/lib/time";
import { periodSummary, pendingReceivables } from "@/lib/finance";
import { getWhatsappConfig } from "@/lib/whatsapp";

/**
 * GET: panel inicial según rol.
 * - Propietario: consolidado del día + métricas del mes + alertas.
 * - Barbero: su agenda del día y sus alertas (sin datos ajenos).
 */
export async function GET(_req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const today = todayKey();
    const r = dayRange(today);

    if (user.role === "OWNER") {
      const [todayAppointments, daySummary, monthSummary, receivables, pendingConfig, unconfirmed] = await Promise.all([
        db.appointment.findMany({
          where: { startTime: { gte: r.from, lt: r.to }, status: { in: ["RESERVED", "CONFIRMED", "IN_ATTENTION", "COMPLETED", "NO_SHOW", "CANCELLED"] } },
          include: { barber: { select: { name: true } }, service: { select: { name: true } } },
          orderBy: { startTime: "asc" },
        }),
        periodSummary(r.from, r.to, "Hoy"),
        (() => {
          const now = new Date();
          const shifted = new Date(now.getTime() - 5 * 3600 * 1000);
          const y = shifted.getUTCFullYear();
          const m = shifted.getUTCMonth();
          const start = `${y}-${String(m + 1).padStart(2, "0")}-01`;
          const nextM = m === 11 ? `${y + 1}-01-01` : `${y}-${String(m + 2).padStart(2, "0")}-01`;
          return periodSummary(dayStartUtc(start), dayStartUtc(nextM), "Mes actual");
        })(),
        pendingReceivables(),
        db.commission.count({ where: { status: "PENDING_CONFIG" } }),
        db.appointment.count({ where: { startTime: { gte: r.from, lt: r.to }, status: "RESERVED" } }),
      ]);

      return ok({
        role: "OWNER",
        today,
        todayAppointments,
        daySummary,
        monthSummary,
        receivables: { totalPendiente: receivables.totalPendiente, rows: receivables.rows.slice(0, 10) },
        alerts: {
          comisionesSinConfigurar: pendingConfig,
          citasSinConfirmar: unconfirmed,
          whatsapp: getWhatsappConfig().configured ? "CONFIGURED" : "PENDING_CONFIG",
        },
      });
    }

    // barbero
    const [myAppointments, myPendingCommissions] = await Promise.all([
      db.appointment.findMany({
        where: { barberId: user.id, startTime: { gte: r.from, lt: r.to } },
        include: { service: { select: { name: true, durationMin: true } } },
        orderBy: { startTime: "asc" },
      }),
      db.commission.count({ where: { barberId: user.id, status: "PENDING_PAYMENT" } }),
    ]);
    return ok({
      role: "BARBER",
      today,
      myAppointments,
      alerts: { comisionesPendientes: myPendingCommissions },
    });
  });
}
