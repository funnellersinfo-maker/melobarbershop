import { NextRequest } from "next/server";
import { handle, ok, ApiError, requireFields } from "@/lib/http";
import { db } from "@/lib/db";
import { requireOwner } from "@/lib/auth";
import { upsertCommissionRule } from "@/lib/commission";
import { audit, snapshot } from "@/lib/audit";
import { getOwnerUsers, notifyUsers } from "@/lib/notify";

/**
 * GET: matriz de reglas vigentes (por barbero × servicio, incluida la regla por
 * defecto del barbero) + historial completo de versiones (requisito C: los cambios
 * futuros no modifican comisiones históricas; el historial es consultable).
 */
export async function GET(_req: NextRequest) {
  return handle(async () => {
    await requireOwner();
    const [barbers, services, rules] = await Promise.all([
      db.user.findMany({ where: { role: "BARBER" }, orderBy: { name: "asc" } }),
      db.service.findMany({ where: {}, orderBy: { sortOrder: "asc" } }),
      db.commissionRule.findMany({ orderBy: { validFrom: "desc" }, take: 1000 }),
    ]);

    const now = new Date();
    const isCurrent = (r: (typeof rules)[number]) =>
      r.validFrom.getTime() <= now.getTime() && (r.validTo === null || r.validTo.getTime() > now.getTime());

    return ok({
      barbers: barbers.map((b) => ({ id: b.id, name: b.name })),
      services: services.map((s) => ({ id: s.id, name: s.name, price: s.price })),
      current: rules.filter(isCurrent),
      history: rules.map((r) => ({ ...r, current: isCurrent(r) })),
    });
  });
}

/**
 * POST: crea una nueva versión de la regla (cierra la vigente con validTo=ahora).
 * No inventa valores: el propietario define tipo/porcentaje/fijo desde el panel.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireOwner();
    const body = (await req.json()) as {
      barberId?: string;
      serviceId?: string | null; // null = regla por defecto del barbero
      commissionType?: "PERCENT" | "FIXED" | "MIXED";
      percent?: number | null;
      fixedAmount?: number | null;
      note?: string | null;
    };
    requireFields(body, ["barberId", "commissionType"]);
    const TYPES = ["PERCENT", "FIXED", "MIXED"];
    if (!TYPES.includes(body.commissionType!)) throw new ApiError(400, "commissionType inválido");

    const result = await db.$transaction(async (tx) => {
      const previous = await tx.commissionRule.findFirst({
        where: {
          barberId: body.barberId!,
          serviceId: body.serviceId ?? null,
          validFrom: { lte: new Date() },
          OR: [{ validTo: null }, { validTo: { gt: new Date() } }],
        },
        orderBy: { validFrom: "desc" },
      });
      const created = await upsertCommissionRule(tx, {
        barberId: body.barberId!,
        serviceId: body.serviceId ?? null,
        commissionType: body.commissionType!,
        percent: body.percent ?? null,
        fixedAmount: body.fixedAmount ?? null,
        note: body.note ?? null,
      });
      return { previous, created };
    });

    await audit({
      entity: "COMMISSION_RULE",
      entityId: result.created.id,
      action: "CONFIG",
      before: result.previous ? snapshot(result.previous) : undefined,
      after: snapshot(result.created),
      user,
    });

    const owners = await getOwnerUsers();
    await notifyUsers(owners.map((o) => o.id), {
      type: "commission.config.changed",
      title: "Regla de comisión actualizada",
      message: `Nueva versión desde ${result.created.validFrom.toISOString()} · ${body.commissionType} · ${user.name}`,
      metadata: { ruleId: result.created.id },
    });

    return ok({ rule: result.created, previousClosed: !!result.previous }, 201);
  });
}
