import { NextRequest } from "next/server";
import { handle, ok, ApiError } from "@/lib/http";
import { requireOwner } from "@/lib/auth";
import { periodSummary, pendingReceivables } from "@/lib/finance";
import { dayStartUtc, todayKey, addDaysKey } from "@/lib/time";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function resolvePeriod(url: URL): { from: Date; to: Date; label: string } {
  const preset = url.searchParams.get("preset");
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const today = todayKey();

  if (fromParam && toParam && DATE_RE.test(fromParam) && DATE_RE.test(toParam)) {
    return { from: dayStartUtc(fromParam), to: new Date(dayStartUtc(toParam).getTime() + 24 * 3600 * 1000), label: `${fromParam} → ${toParam}` };
  }
  if (preset === "today") {
    return { from: dayStartUtc(today), to: new Date(dayStartUtc(today).getTime() + 24 * 3600 * 1000), label: `Hoy (${today})` };
  }
  if (preset === "week") {
    // lunes de esta semana (Bogotá)
    const now = new Date();
    const dow = new Date(now.getTime() - 5 * 3600 * 1000).getUTCDay();
    const mondayKey = addDaysKey(today, dow === 0 ? -6 : 1 - dow);
    return { from: dayStartUtc(mondayKey), to: new Date(dayStartUtc(today).getTime() + 24 * 3600 * 1000), label: `Semana actual (${mondayKey} → ${today})` };
  }
  if (preset === "month") {
    const now = new Date();
    const shifted = new Date(now.getTime() - 5 * 3600 * 1000);
    const y = shifted.getUTCFullYear();
    const m = shifted.getUTCMonth();
    const start = `${y}-${String(m + 1).padStart(2, "0")}-01`;
    const nextM = m === 11 ? `${y + 1}-01-01` : `${y}-${String(m + 2).padStart(2, "0")}-01`;
    return { from: dayStartUtc(start), to: dayStartUtc(nextM), label: `Mes actual (${start})` };
  }
  throw new ApiError(400, "Indique preset=today|week|month o from/to (YYYY-MM-DD)");
}

/**
 * GET /api/reports/summary?preset=... — consolidado del negocio (requisito D).
 * Distingue ventas brutas/descuentos/cobrado, comisiones pagadas y pendientes,
 * gastos, flujo de caja y resultado operativo (una sola vez comisiones+gastos).
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireOwner();
    const url = new URL(req.url);
    const { from, to, label } = resolvePeriod(url);
    const [summary, receivables] = await Promise.all([periodSummary(from, to, label), pendingReceivables()]);
    return ok({
      summary,
      receivables,
      generatedAt: new Date().toISOString(),
      conventions: {
        ventasYComisiones: "Por fecha de completado de la cita",
        caja: "Por fecha de transacción (pagos recibidos, gastos y pagos a barberos)",
        resultado: "Ventas netas − comisiones generadas − gastos (cada concepto se descuenta una sola vez)",
      },
    });
  });
}
