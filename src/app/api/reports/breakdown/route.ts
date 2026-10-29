import { NextRequest } from "next/server";
import { handle, ok, ApiError } from "@/lib/http";
import { requireOwner } from "@/lib/auth";
import { barberBreakdown, serviceBreakdown } from "@/lib/finance";
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
    const now = new Date();
    const dow = new Date(now.getTime() - 5 * 3600 * 1000).getUTCDay();
    const mondayKey = addDaysKey(today, dow === 0 ? -6 : 1 - dow);
    return { from: dayStartUtc(mondayKey), to: new Date(dayStartUtc(today).getTime() + 24 * 3600 * 1000), label: `Semana actual` };
  }
  if (preset === "month") {
    const now = new Date();
    const shifted = new Date(now.getTime() - 5 * 3600 * 1000);
    const y = shifted.getUTCFullYear();
    const m = shifted.getUTCMonth();
    const start = `${y}-${String(m + 1).padStart(2, "0")}-01`;
    const nextM = m === 11 ? `${y + 1}-01-01` : `${y}-${String(m + 2).padStart(2, "0")}-01`;
    return { from: dayStartUtc(start), to: dayStartUtc(nextM), label: `Mes actual` };
  }
  throw new ApiError(400, "Indique preset=today|week|month o from/to");
}

/**
 * GET: desglose por barbero y por servicio (requisito D: distinguir las ventas
 * de cada barbero del dinero que pertenece al negocio tras aplicar comisiones).
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireOwner();
    const url = new URL(req.url);
    const { from, to, label } = resolvePeriod(url);
    const [byBarber, byService] = await Promise.all([barberBreakdown(from, to), serviceBreakdown(from, to)]);
    return ok({ period: label, byBarber, byService });
  });
}
