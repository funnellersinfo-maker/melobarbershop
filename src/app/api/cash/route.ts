import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/http";
import { requireOwner } from "@/lib/auth";
import { cashMovements } from "@/lib/finance";
import { dayStartUtc, todayKey } from "@/lib/time";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/cash?from&to — movimientos de caja y conciliación (requisito D).
 * Balance = ingresos por pagos − gastos − anticipos − liquidaciones pagadas.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireOwner();
    const url = new URL(req.url);
    const today = todayKey();
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const fromd = from && DATE_RE.test(from) ? dayStartUtc(from) : dayStartUtc(today);
    const tod = to && DATE_RE.test(to) ? new Date(dayStartUtc(to).getTime() + 24 * 3600 * 1000) : new Date(dayStartUtc(today).getTime() + 24 * 3600 * 1000);
    const { movements, balance } = await cashMovements(fromd, tod);
    return ok({
      period: { from: fromd.toISOString(), to: tod.toISOString() },
      movements,
      balance,
    });
  });
}
