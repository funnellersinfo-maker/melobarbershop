"use client";
// Motor financiero en cliente: resúmenes, desgloses, caja y cartera.
import { type DB, getDB } from "@/lib/store";
import { dateKeyInBogota, dayStartUtc, dayEndUtc } from "@/lib/time";

export type PeriodSummary = {
  period: { from: string; to: string; label: string };
  ventas: { brutas: number; descuentos: number; netas: number; completadas: number };
  caja: {
    cobrado: number; devuelto: number; porMetodo: Record<string, number>;
    gastos: number; liquidacionesPagadas: number; anticiposPagados: number;
    totalPagosBarberos: number; flujoNeto: number;
  };
  comisiones: { generadas: number; pagadas: number; pendientes: number; pendientesConfigurar: number };
  resultado: { antesComisiones: number; despuesComisiones: number; operativoEstimado: number };
};

export type CashMovement = {
  date: string; kind: "INGRESO" | "EGRESO"; concept: string; detail: string;
  amount: number; source: "PAYMENT" | "EXPENSE" | "ADVANCE" | "SETTLEMENT"; method?: string;
};

function inRange(iso: string, from: Date, to: Date): boolean {
  const t = new Date(iso).getTime();
  return t >= from.getTime() && t < to.getTime();
}

export function periodRange(preset: "today" | "week" | "month" | "custom", from?: string, to?: string): { from: Date; to: Date; label: string } {
  const now = new Date();
  const todayK = dateKeyInBogota(now);
  if (preset === "today") {
    return { from: dayStartUtc(todayK), to: dayEndUtc(todayK), label: `Hoy (${todayK})` };
  }
  if (preset === "week") {
    // semana actual: lunes a domingo
    const p = new Date(now.getTime() - 5 * 3600 * 1000);
    const dow = p.getUTCDay();
    const mondayKey = dateKeyInBogota(new Date(now.getTime() - ((dow + 6) % 7) * 24 * 3600 * 1000));
    const sundayKey = dateKeyInBogota(new Date(now.getTime() + (7 - ((dow + 6) % 7)) * 24 * 3600 * 1000 - 1));
    return { from: dayStartUtc(mondayKey), to: dayStartUtc(dateKeyInBogota(new Date(dayStartUtc(sundayKey).getTime() + 24 * 3600 * 1000))), label: `Semana (${mondayKey} → ${sundayKey})` };
  }
  if (preset === "month") {
    const p = new Date(now.getTime() - 5 * 3600 * 1000);
    const y = p.getUTCFullYear();
    const m = p.getUTCMonth();
    const start = new Date(Date.UTC(y, m, 1, 5));
    const end = new Date(Date.UTC(y, m + 1, 1, 5));
    const label = `Mes (${start.toISOString().slice(0, 7)})`;
    return { from: start, to: end, label };
  }
  const f = from ?? todayK;
  const t = to ?? todayK;
  return { from: dayStartUtc(f), to: dayEndUtc(t), label: `${f} → ${t}` };
}

export function periodSummary(db: DB, from: Date, to: Date, label = ""): PeriodSummary {
  const completed = db.appointments.filter((a) => a.status === "COMPLETED" && a.completedAt && inRange(a.completedAt, from, to));
  const payments = db.payments.filter((p) => inRange(p.receivedAt, from, to));
  const commissions = db.commissions.filter((c) => inRange(c.createdAt, from, to));
  const expenses = db.expenses.filter((e) => inRange(e.spentAt, from, to));
  const settlements = db.settlements.filter((s) => s.status === "PAID" && s.paidAt && inRange(s.paidAt, from, to));
  const advances = db.adjustments.filter((a) => a.type === "ADVANCE" && inRange(a.createdAt, from, to));

  const brutas = completed.reduce((s, a) => s + a.priceSnapshot, 0);
  const descuentos = completed.reduce((s, a) => s + a.discount, 0);
  const netas = brutas - descuentos;

  const cobradoBruto = payments.reduce((s, p) => s + p.amount, 0);
  const devuelto = payments.reduce((s, p) => s + p.refundedAmount, 0);
  const cobrado = cobradoBruto - devuelto;
  const porMetodo: Record<string, number> = {};
  for (const p of payments) porMetodo[p.method] = (porMetodo[p.method] ?? 0) + (p.amount - p.refundedAmount);

  const comisionesGeneradas = commissions.reduce((s, c) => s + c.calculatedAmount, 0);
  const comisionesPagadas = commissions.filter((c) => c.status === "PAID").reduce((s, c) => s + c.calculatedAmount, 0);
  const comisionesPendientes = comisionesGeneradas - comisionesPagadas;
  const pendientesConfigurar = commissions.filter((c) => c.status === "PENDING_CONFIG").length;

  const gastos = expenses.reduce((s, e) => s + e.amount, 0);
  const liquidacionesPagadas = settlements.reduce((s, st) => s + st.totalAmount, 0);
  const anticiposPagados = advances.reduce((s, a) => s + Math.abs(a.amount), 0);
  const totalPagosBarberos = liquidacionesPagadas + anticiposPagados;

  return {
    period: { from: from.toISOString(), to: to.toISOString(), label },
    ventas: { brutas, descuentos, netas, completadas: completed.length },
    caja: { cobrado, devuelto, porMetodo, gastos, liquidacionesPagadas, anticiposPagados, totalPagosBarberos, flujoNeto: cobrado - gastos - totalPagosBarberos },
    comisiones: { generadas: comisionesGeneradas, pagadas: comisionesPagadas, pendientes: comisionesPendientes, pendientesConfigurar },
    resultado: {
      antesComisiones: netas,
      despuesComisiones: netas - comisionesGeneradas,
      operativoEstimado: netas - comisionesGeneradas - gastos,
    },
  };
}

export function barberBreakdown(db: DB, from: Date, to: Date) {
  const map = new Map<string, { barberId: string; barberName: string; citas: number; brutas: number; descuentos: number; netas: number; comisiones: number; negocio: number; cobrado: number }>();
  for (const b of db.barbers) {
    map.set(b.id, { barberId: b.id, barberName: b.name, citas: 0, brutas: 0, descuentos: 0, netas: 0, comisiones: 0, negocio: 0, cobrado: 0 });
  }
  for (const a of db.appointments) {
    if (a.status !== "COMPLETED" || !a.completedAt || !inRange(a.completedAt, from, to)) continue;
    const row = map.get(a.barberId);
    if (!row) continue;
    row.citas += 1;
    row.brutas += a.priceSnapshot;
    row.descuentos += a.discount;
    row.netas += a.priceSnapshot - a.discount;
    const pays = db.payments.filter((p) => p.appointmentId === a.id);
    row.cobrado += pays.reduce((s, p) => s + p.amount - p.refundedAmount, 0);
  }
  for (const c of db.commissions) {
    if (!inRange(c.createdAt, from, to)) continue;
    const row = map.get(c.barberId);
    if (!row) continue;
    row.comisiones += c.calculatedAmount;
  }
  return Array.from(map.values()).map((r) => ({ ...r, negocio: r.netas - r.comisiones }));
}

export function serviceBreakdown(db: DB, from: Date, to: Date) {
  const map = new Map<string, { serviceId: string; serviceName: string; citas: number; brutas: number; netas: number; comisiones: number }>();
  for (const s of db.services) map.set(s.id, { serviceId: s.id, serviceName: s.name, citas: 0, brutas: 0, netas: 0, comisiones: 0 });
  for (const a of db.appointments) {
    if (a.status !== "COMPLETED" || !a.completedAt || !inRange(a.completedAt, from, to)) continue;
    const row = map.get(a.serviceId);
    if (!row) continue;
    row.citas += 1;
    row.brutas += a.priceSnapshot;
    row.netas += a.priceSnapshot - a.discount;
    const com = db.commissions.find((c) => c.appointmentId === a.id);
    row.comisiones += com?.calculatedAmount ?? 0;
  }
  return Array.from(map.values());
}

export function cashMovements(db: DB, from: Date, to: Date): { movements: CashMovement[]; balance: number } {
  const movements: CashMovement[] = [];
  for (const p of db.payments) {
    if (!inRange(p.receivedAt, from, to)) continue;
    const appt = db.appointments.find((a) => a.id === p.appointmentId);
    const net = p.amount - p.refundedAmount;
    movements.push({
      date: p.receivedAt,
      kind: net >= 0 ? "INGRESO" : "EGRESO",
      concept: "Pago de cita",
      detail: `${appt?.code ?? "?"} · ${appt?.clientName ?? ""}${p.refundedAmount > 0 ? ` (devolución $ ${p.refundedAmount.toLocaleString("es-CO")})` : ""}`,
      amount: Math.abs(net),
      source: "PAYMENT",
      method: p.method,
    });
  }
  for (const e of db.expenses) {
    if (!inRange(e.spentAt, from, to)) continue;
    movements.push({ date: e.spentAt, kind: "EGRESO", concept: "Gasto operativo", detail: e.description, amount: e.amount, source: "EXPENSE", method: e.method ?? undefined });
  }
  for (const a of db.adjustments) {
    if (a.type !== "ADVANCE" || !inRange(a.createdAt, from, to)) continue;
    movements.push({ date: a.createdAt, kind: "EGRESO", concept: "Anticipo a barbero", detail: a.reason, amount: Math.abs(a.amount), source: "ADVANCE" });
  }
  for (const s of db.settlements) {
    if (s.status !== "PAID" || !s.paidAt || !inRange(s.paidAt, from, to)) continue;
    movements.push({ date: s.paidAt, kind: "EGRESO", concept: "Liquidación de comisiones", detail: `${s.code} · pago de comisiones`, amount: s.totalAmount, source: "SETTLEMENT", method: s.paymentMethod ?? undefined });
  }
  movements.sort((a, b) => a.date.localeCompare(b.date));
  const balance = movements.reduce((s, m) => s + (m.kind === "INGRESO" ? m.amount : -m.amount), 0);
  return { movements, balance };
}

export function pendingReceivables(db: DB) {
  let totalPendiente = 0;
  const rows: Array<{ code: string; client: string; net: number; pagado: number; pendiente: number; completedAt: string }> = [];
  for (const a of db.appointments) {
    if (a.status !== "COMPLETED" || !a.completedAt) continue;
    const net = a.priceSnapshot - a.discount;
    const pagado = db.payments.filter((p) => p.appointmentId === a.id).reduce((s, p) => s + p.amount - p.refundedAmount, 0);
    const pendiente = Math.max(0, net - pagado);
    if (pendiente > 0) {
      totalPendiente += pendiente;
      rows.push({ code: a.code, client: a.clientName, net, pagado, pendiente, completedAt: a.completedAt });
    }
  }
  rows.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  return { totalPendiente, rows };
}

// ---------- liquidaciones ----------
export function createSettlement(
  barberId: string,
  commissionIds: string[],
  adjustmentIds: string[],
  notes: string | null,
  actorName: string
): void {
  const db = getDB();
  const barber = db.barbers.find((b) => b.id === barberId);
  if (!barber) throw new Error("Barbero no encontrado");
  const commissions = db.commissions.filter((c) => commissionIds.includes(c.id) && c.barberId === barberId && c.status === "PENDING_PAYMENT");
  const adjustments = db.adjustments.filter((a) => adjustmentIds.includes(a.id) && a.barberId === barberId && a.status === "PENDING");
  if (commissions.length === 0 && adjustments.length === 0) throw new Error("Selecciona al menos una comisión o ajuste pendiente");

  const totalCommissions = commissions.reduce((s, c) => s + c.calculatedAmount, 0);
  const totalAdjustments = adjustments.reduce((s, a) => s + a.amount, 0);
  const total = totalCommissions + totalAdjustments;
  if (total < 0) throw new Error("El total de la liquidación no puede ser negativo");

  const codes = new Set(db.settlements.map((s) => s.code));
  let code = `LQ-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  while (codes.has(code)) code = `LQ-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

  const { mutateDB, audit } = require("@/lib/store") as typeof import("@/lib/store");
  const items = [
    ...commissions.map((c) => {
      const appt = db.appointments.find((a) => a.id === c.appointmentId);
      return { id: `it-${Math.random().toString(36).slice(2, 9)}`, itemType: "COMMISSION" as const, label: `Comisión ${appt?.code ?? ""} · ${c.snapshot.serviceName}`, amount: c.calculatedAmount, commissionId: c.id, adjustmentId: null };
    }),
    ...adjustments.map((a) => ({
      id: `it-${Math.random().toString(36).slice(2, 9)}`,
      itemType: (a.type === "ADVANCE" ? "ADVANCE" : a.type === "REFUND" ? "REFUND" : "MANUAL") as "ADVANCE" | "REFUND" | "MANUAL",
      label: `${a.type === "ADVANCE" ? "Anticipo" : a.type === "REFUND" ? "Devolución" : "Ajuste"}: ${a.reason}`,
      amount: a.amount,
      commissionId: null,
      adjustmentId: a.id,
    })),
  ];

  const settlement = {
    id: `stl-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`,
    code,
    barberId,
    status: "DRAFT" as const,
    notes,
    totalCommissions,
    totalAdjustments,
    totalAmount: total,
    approvedByName: null,
    approvedAt: null,
    paidAt: null,
    paymentMethod: null,
    createdAt: new Date().toISOString(),
    items,
  };
  mutateDB((d) => {
    d.settlements.unshift(settlement);
  });
  audit("SETTLEMENT", settlement.id, "CREATE_DRAFT", actorName, null, settlement);
}

export function approveSettlement(settlementId: string, actorName: string, isOwn: boolean): void {
  const db = getDB();
  const s = db.settlements.find((x) => x.id === settlementId);
  if (!s) throw new Error("Liquidación no encontrada");
  if (s.status !== "DRAFT") throw new Error("Solo se aprueban borradores");
  if (isOwn && !(db.barbers.find((b) => b.id === s.barberId)?.permissions["settlements.approveOwn"])) {
    throw new Error("No tienes permiso para aprobar tus propias liquidaciones");
  }
  const { mutateDB, audit } = require("@/lib/store") as typeof import("@/lib/store");
  mutateDB((d) => {
    const st = d.settlements.find((x) => x.id === settlementId)!;
    st.status = "APPROVED";
    st.approvedByName = actorName;
    st.approvedAt = new Date().toISOString();
  });
  audit("SETTLEMENT", settlementId, "APPROVE", actorName, { status: "DRAFT" }, { status: "APPROVED" });
}

export function paySettlement(settlementId: string, method: string, externalRef: string | null, actorName: string): void {
  const db = getDB();
  const s = db.settlements.find((x) => x.id === settlementId);
  if (!s) throw new Error("Liquidación no encontrada");
  if (s.status !== "APPROVED") throw new Error("La liquidación debe estar aprobada");
  const { mutateDB, audit, pushNotification } = require("@/lib/store") as typeof import("@/lib/store");
  mutateDB((d) => {
    const st = d.settlements.find((x) => x.id === settlementId)!;
    st.status = "PAID";
    st.paidAt = new Date().toISOString();
    st.paymentMethod = method;
    for (const it of st.items) {
      if (it.commissionId) {
        const c = d.commissions.find((c2) => c2.id === it.commissionId);
        if (c) c.status = "PAID";
      }
      if (it.adjustmentId) {
        const a = d.adjustments.find((a2) => a2.id === it.adjustmentId);
        if (a) a.status = "SETTLED";
      }
    }
  });
  audit("SETTLEMENT", settlementId, "PAY", actorName, { status: "APPROVED" }, { status: "PAID", method });
  const barber = db.barbers.find((b) => b.id === s.barberId);
  pushNotification(s.barberId, "settlement.paid", "💵 Liquidación pagada", `${s.code} · $ ${s.totalAmount.toLocaleString("es-CO")} · método ${method}${barber ? "" : ""}`);
}
