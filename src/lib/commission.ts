// Motor de comisiones: resolución de reglas vigentes, cálculo y SNAPSHOT
// inmutable de las condiciones económicas al completar cada operación (requisito C).
// Los cambios futuros de reglas jamás modifican comisiones históricas.
import { db } from "@/lib/db";
import type { Prisma, Appointment, CommissionRule, Commission } from "@prisma/client";
import { ApiError } from "@/lib/http";
import { snapshot } from "@/lib/audit";

export type RuleSource = "SPECIFIC" | "BARBER_DEFAULT" | "NONE";

export type ResolvedRule = {
  rule: CommissionRule | null;
  source: RuleSource;
};

/**
 * Resuelve la regla vigente para (barbero, servicio) en un instante dado.
 * 1) Regla específica del servicio (serviceId = X) más reciente con vigencia activa.
 * 2) Si no hay, regla por defecto del barbero (serviceId = null).
 * 3) Si no hay ninguna: NONE.
 */
export async function resolveRule(
  tx: Prisma.TransactionClient,
  barberId: string,
  serviceId: string,
  at: Date = new Date()
): Promise<ResolvedRule> {
  const specific = await tx.commissionRule.findFirst({
    where: {
      barberId,
      serviceId,
      validFrom: { lte: at },
      OR: [{ validTo: null }, { validTo: { gt: at } }],
    },
    orderBy: { validFrom: "desc" },
  });
  if (specific) return { rule: specific, source: "SPECIFIC" };

  const def = await tx.commissionRule.findFirst({
    where: {
      barberId,
      serviceId: null,
      validFrom: { lte: at },
      OR: [{ validTo: null }, { validTo: { gt: at } }],
    },
    orderBy: { validFrom: "desc" },
  });
  if (def) return { rule: def, source: "BARBER_DEFAULT" };
  return { rule: null, source: "NONE" };
}

export function commissionAmount(rule: CommissionRule | null, base: number): number {
  if (!rule) return 0;
  const percent = rule.percent ?? 0;
  const fixed = rule.fixedAmount ?? 0;
  switch (rule.commissionType) {
    case "PERCENT":
      return Math.round((base * percent) / 100);
    case "FIXED":
      return fixed;
    case "MIXED":
      return Math.round((base * percent) / 100) + fixed;
    default:
      return 0;
  }
}

/**
 * Crea la comisión con copia histórica al COMPLETAR la cita.
 * Base de cálculo: venta neta = precio (copia de la cita) - descuento aplicado.
 */
export async function createCommissionOnCompletion(
  tx: Prisma.TransactionClient,
  appointment: Appointment,
  discount: number
): Promise<Commission> {
  const existing = await tx.commission.findUnique({ where: { appointmentId: appointment.id } });
  if (existing) throw new ApiError(409, "La cita ya tiene una comisión registrada");

  if (discount < 0 || discount > appointment.priceSnapshot) {
    throw new ApiError(400, "Descuento inválido");
  }
  const base = appointment.priceSnapshot - discount;
  const at = new Date();
  const { rule, source } = await resolveRule(tx, appointment.barberId, appointment.serviceId, at);
  const configured = !!rule;
  const amount = commissionAmount(rule, base);

  const service = await tx.service.findUnique({ where: { id: appointment.serviceId } });
  const snapshotData = {
    snapshotVersion: 1,
    completedAt: at.toISOString(),
    service: {
      id: appointment.serviceId,
      name: service?.name ?? "?",
      priceListAtCompletion: service?.price ?? null, // referencia: precio de catálogo en ese momento
      priceSnapshotOfAppointment: appointment.priceSnapshot,
    },
    discount,
    base,
    rule: rule
      ? {
          id: rule.id,
          source,
          commissionType: rule.commissionType,
          percent: rule.percent,
          fixedAmount: rule.fixedAmount,
          validFrom: rule.validFrom.toISOString(),
          note: rule.note,
        }
      : { source: "NONE" as const, note: "Sin regla de comisión vigente al completar la operación" },
    calculatedBy: "system",
    result: { configured, amount },
  };

  return tx.commission.create({
    data: {
      appointmentId: appointment.id,
      barberId: appointment.barberId,
      status: configured ? "PENDING_PAYMENT" : "PENDING_CONFIG",
      configured,
      commissionType: rule?.commissionType ?? null,
      percent: rule?.percent ?? null,
      fixedAmount: rule?.fixedAmount ?? null,
      baseAmount: base,
      calculatedAmount: amount,
      snapshotJson: JSON.stringify(snapshotData),
    },
  });
}

/**
 * Definición manual por el propietario de una comisión que quedó PENDING_CONFIG.
 * Es un cambio explícito y auditable, nunca silencioso.
 */
export async function manualSetCommission(
  tx: Prisma.TransactionClient,
  commissionId: string,
  amount: number,
  reason: string,
  userId: string
): Promise<Commission> {
  const c = await tx.commission.findUnique({ where: { id: commissionId } });
  if (!c) throw new ApiError(404, "Comisión no encontrada");
  if (c.status !== "PENDING_CONFIG") throw new ApiError(400, "Solo se pueden definir manualmente las comisiones sin configurar");
  if (amount <= 0) throw new ApiError(400, "El valor debe ser mayor que cero");
  if (!reason?.trim()) throw new ApiError(400, "El motivo es obligatorio");

  const before = { ...c };
  const updated = await tx.commission.update({
    where: { id: commissionId },
    data: {
      calculatedAmount: Math.round(amount),
      manualSet: true,
      manualReason: reason.trim(),
      status: "PENDING_PAYMENT",
    },
  });
  await tx.auditLog.create({
    data: {
      entity: "COMMISSION",
      entityId: commissionId,
      action: "MANUAL_SET",
      beforeJson: snapshot(before),
      afterJson: snapshot(updated),
      userId,
    },
  });
  return updated;
}

// ---------- Configuración de reglas (versión cerrada + nueva versión) ----------
export async function upsertCommissionRule(
  tx: Prisma.TransactionClient,
  params: {
    barberId: string;
    serviceId: string | null;
    commissionType: "PERCENT" | "FIXED" | "MIXED";
    percent?: number | null;
    fixedAmount?: number | null;
    note?: string | null;
  }
): Promise<CommissionRule> {
  const { barberId, serviceId, commissionType } = params;
  if (commissionType === "PERCENT" && (params.percent === null || params.percent === undefined)) {
    throw new ApiError(400, "El porcentaje es obligatorio en la regla por porcentaje");
  }
  if (commissionType === "FIXED" && (params.fixedAmount === null || params.fixedAmount === undefined)) {
    throw new ApiError(400, "El valor fijo es obligatorio en la regla por valor fijo");
  }
  if (commissionType === "MIXED" && (params.percent === null || params.percent === undefined || params.fixedAmount === null || params.fixedAmount === undefined)) {
    throw new ApiError(400, "El esquema mixto requiere porcentaje y valor fijo");
  }
  if (params.percent !== null && params.percent !== undefined && (params.percent < 0 || params.percent > 100)) {
    throw new ApiError(400, "El porcentaje debe estar entre 0 y 100");
  }
  if (params.fixedAmount !== null && params.fixedAmount !== undefined && params.fixedAmount < 0) {
    throw new ApiError(400, "El valor fijo no puede ser negativo");
  }

  const now = new Date();
  // cerrar versión vigente (si existe)
  const current = await tx.commissionRule.findFirst({
    where: {
      barberId,
      serviceId,
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gt: now } }],
    },
    orderBy: { validFrom: "desc" },
  });
  if (current) {
    await tx.commissionRule.update({ where: { id: current.id }, data: { validTo: now } });
  }
  return tx.commissionRule.create({
    data: {
      barberId,
      serviceId,
      commissionType,
      percent: params.percent ?? null,
      fixedAmount: params.fixedAmount ?? null,
      note: params.note ?? null,
      validFrom: now,
    },
  });
}

export async function getEffectiveRules(barberIds: string[]) {
  if (barberIds.length === 0) return { rules: [] as CommissionRule[] };
  const now = new Date();
  const all = await db.commissionRule.findMany({
    where: {
      barberId: { in: barberIds },
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gt: now } }],
    },
    orderBy: { validFrom: "desc" },
  });
  // solo la más reciente por (barbero, servicio|null)
  const seen = new Set<string>();
  const rules: CommissionRule[] = [];
  for (const r of all) {
    const key = `${r.barberId}:${r.serviceId ?? "DEF"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push(r);
  }
  return { rules };
}
