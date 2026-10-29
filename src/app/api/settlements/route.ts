import { NextRequest } from "next/server";
import { handle, ok, ApiError, requireFields } from "@/lib/http";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { financeScope } from "@/lib/rbac";
import { audit, snapshot } from "@/lib/audit";

const CODE_PREFIX = "LQ";
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function settlementCode(): string {
  let s = "";
  for (let i = 0; i < 5; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return `${CODE_PREFIX}-${s}`;
}

/**
 * GET: liquidaciones. Barberos ven las propias; propietario todas.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const url = new URL(req.url);
    const barberId = url.searchParams.get("barberId");
    const scope = financeScope(user, barberId);
    const where = {} as { barberId?: string };
    if (scope.barberId !== "all") where.barberId = scope.barberId;
    else if (barberId) where.barberId = barberId;

    const settlements = await db.settlement.findMany({
      where,
      include: {
        barber: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        items: {
          include: {
            commission: { include: { appointment: { select: { code: true, service: { select: { name: true } } } } } },
            adjustment: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return ok({ settlements });
  });
}

/**
 * POST: borrador de liquidación (requisito C). El servidor calcula todos los
 * totales; el cliente solo elige qué comisiones y ajustes incluir.
 * Anticipos y devoluciones restan; ajustes manuales suman o restan según signo.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    if (user.role !== "OWNER") throw new ApiError(403, "Solo el propietario crea liquidaciones");
    const body = (await req.json()) as {
      barberId?: string;
      commissionIds?: string[];
      adjustmentIds?: string[];
      notes?: string;
      periodStart?: string;
      periodEnd?: string;
    };
    requireFields(body, ["barberId"]);
    const commissionIds = body.commissionIds ?? [];
    const adjustmentIds = body.adjustmentIds ?? [];

    const settlement = await db.$transaction(async (tx) => {
      const barber = await tx.user.findUnique({ where: { id: body.barberId! } });
      if (!barber || barber.role !== "BARBER") throw new ApiError(404, "Barbero no encontrado");

      const commissions = commissionIds.length
        ? await tx.commission.findMany({ where: { id: { in: commissionIds }, barberId: body.barberId!, status: "PENDING_PAYMENT" } })
        : [];
      const foundCommissionIds = new Set(commissions.map((c) => c.id));
      const missing = commissionIds.filter((cid) => !foundCommissionIds.has(cid));
      if (missing.length) throw new ApiError(400, `Comisiones no pendientes o ajenas: ${missing.join(", ")}`);

      const adjustments = adjustmentIds.length
        ? await tx.commissionAdjustment.findMany({ where: { id: { in: adjustmentIds }, barberId: body.barberId!, status: "PENDING" } })
        : [];
      const foundAdjIds = new Set(adjustments.map((a) => a.id));
      const missingAdj = adjustmentIds.filter((aid) => !foundAdjIds.has(aid));
      if (missingAdj.length) throw new ApiError(400, `Ajustes no pendientes o ajenos: ${missingAdj.join(", ")}`);

      const totalCommissions = commissions.reduce((s, c) => s + c.calculatedAmount, 0);
      const totalAdjustments = adjustments.reduce((s, a) => s + a.amount, 0); // amount ya trae el signo
      const totalAmount = totalCommissions + totalAdjustments;
      if (totalAmount < 0) throw new ApiError(400, "El total de la liquidación no puede ser negativo");

      const code = settlementCode();
      const created = await tx.settlement.create({
        data: {
          code,
          barberId: body.barberId!,
          status: "DRAFT",
          notes: body.notes?.trim() || null,
          periodStart: body.periodStart ? new Date(body.periodStart) : null,
          periodEnd: body.periodEnd ? new Date(body.periodEnd) : null,
          totalCommissions,
          totalAdjustments,
          totalAmount,
        },
      });

      for (const c of commissions) {
        await tx.settlementItem.create({
          data: {
            settlementId: created.id,
            itemType: "COMMISSION",
            label: `Comisión ${c.baseAmount > 0 ? `sobre ${c.baseAmount}` : ""}`.trim(),
            amount: c.calculatedAmount,
            commissionId: c.id,
          },
        });
      }
      const adjLabel: Record<string, string> = { ADVANCE: "Anticipo", REFUND: "Devolución", MANUAL: "Ajuste" };
      for (const a of adjustments) {
        await tx.settlementItem.create({
          data: {
            settlementId: created.id,
            itemType: a.type,
            label: `${adjLabel[a.type] ?? "Ajuste"} · ${a.reason}`,
            amount: a.amount,
            adjustmentId: a.id,
          },
        });
      }
      return created;
    });

    await audit({ entity: "SETTLEMENT", entityId: settlement.id, action: "CREATE_DRAFT", after: snapshot(settlement), user });
    return ok({ settlement }, 201);
  });
}
