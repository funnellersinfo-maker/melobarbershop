import { NextRequest } from "next/server";
import { handle, ok, requireFields } from "@/lib/http";
import { db } from "@/lib/db";
import { requireOwner } from "@/lib/auth";
import { manualSetCommission } from "@/lib/commission";
import { notifyBarberAndOwner } from "@/lib/notify";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST: el propietario define manualmente el valor de una comisión que quedó
 * sin configurar (PENDING_CONFIG). Cambio explícito, con motivo y auditoría.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const user = await requireOwner();
    const { id } = await ctx.params;
    const body = (await req.json()) as { amount?: number; reason?: string };
    requireFields(body, ["amount", "reason"]);

    const commission = await db.$transaction((tx) => manualSetCommission(tx, id, Number(body.amount), body.reason!, user.id));
    await notifyBarberAndOwner(commission.barberId, {
      type: "commission.manual_set",
      title: "Comisión definida manualmente",
      message: `Comisión de ${commission.calculatedAmount} definida por ${user.name}. Motivo: ${body.reason}`,
      metadata: { commissionId: id },
    });
    return ok({ commission });
  });
}
