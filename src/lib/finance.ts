// Motor financiero (requisitos C y D).
// Convenciones claras para NO restar dos veces:
//  - Ventas (brutas/descuentos/netas) y comisiones generadas: por FECHA DE COMPLETADO.
//  - Dinero cobrado, gastos y pagos a barberos: por FECHA DE TRANSACCIÓN (caja).
//  - El resultado operativo descuenta UNA sola vez las comisiones y los gastos.
//  - El flujo de caja solo registra movimientos reales de dinero (nunca comisiones pendientes).
import { db } from "@/lib/db";

export type PeriodSummary = {
  period: { from: string; to: string; label: string };
  ventas: { brutas: number; descuentos: number; netas: number; completadas: number };
  caja: {
    cobrado: number;
    devuelto: number;
    porMetodo: Record<string, number>;
    gastos: number;
    liquidacionesPagadas: number;
    anticiposPagados: number;
    totalPagosBarberos: number;
    flujoNeto: number;
  };
  comisiones: { generadas: number; pagadas: number; pendientes: number; pendientesConfigurar: number };
  resultado: { antesComisiones: number; despuesComisiones: number; operativoEstimado: number };
};

export type BarberBreakdown = {
  barberId: string;
  barberName: string;
  citas: number;
  brutas: number;
  descuentos: number;
  netas: number;
  comisiones: number;
  negocio: number; // lo que queda para el negocio después de comisiones
  cobrado: number;
};

export type ServiceBreakdown = {
  serviceId: string;
  serviceName: string;
  citas: number;
  brutas: number;
  netas: number;
  comisiones: number;
};

export type CashMovement = {
  date: string;
  kind: "INGRESO" | "EGRESO";
  concept: string;
  detail: string;
  amount: number; // positivo
  source: "PAYMENT" | "EXPENSE" | "ADVANCE" | "SETTLEMENT";
  method?: string;
};

export async function periodSummary(from: Date, to: Date, label = ""): Promise<PeriodSummary> {
  const [completed, payments, commissions, expenses, settlements, advances] = await Promise.all([
    db.appointment.findMany({
      where: { status: "COMPLETED", completedAt: { gte: from, lt: to } },
      select: { priceSnapshot: true, discount: true, barberId: true },
    }),
    db.payment.findMany({
      where: { receivedAt: { gte: from, lt: to } },
      select: { amount: true, refundedAmount: true, method: true },
    }),
    db.commission.findMany({
      where: { createdAt: { gte: from, lt: to } },
      select: { calculatedAmount: true, status: true },
    }),
    db.expense.findMany({ where: { spentAt: { gte: from, lt: to } }, select: { amount: true } }),
    db.settlement.findMany({
      where: { status: "PAID", paidAt: { gte: from, lt: to } },
      select: { totalAmount: true },
    }),
    db.commissionAdjustment.findMany({
      where: { type: "ADVANCE", createdAt: { gte: from, lt: to } },
      select: { amount: true },
    }),
  ]);

  const brutas = completed.reduce((s, a) => s + a.priceSnapshot, 0);
  const descuentos = completed.reduce((s, a) => s + a.discount, 0);
  const netas = brutas - descuentos;

  const cobradoBruto = payments.reduce((s, p) => s + p.amount, 0);
  const devuelto = payments.reduce((s, p) => s + p.refundedAmount, 0);
  const cobrado = cobradoBruto - devuelto;
  const porMetodo: Record<string, number> = {};
  for (const p of payments) {
    porMetodo[p.method] = (porMetodo[p.method] ?? 0) + (p.amount - p.refundedAmount);
  }

  const comisionesGeneradas = commissions.reduce((s, c) => s + c.calculatedAmount, 0);
  const comisionesPagadas = commissions.filter((c) => c.status === "PAID").reduce((s, c) => s + c.calculatedAmount, 0);
  const comisionesPendientes = comisionesGeneradas - comisionesPagadas;
  const pendientesConfigurar = commissions.filter((c) => c.status === "PENDING_CONFIG").length;

  const gastos = expenses.reduce((s, e) => s + e.amount, 0);
  const liquidacionesPagadas = settlements.reduce((s, st) => s + st.totalAmount, 0);
  const anticiposPagados = advances.reduce((s, a) => s + Math.abs(a.amount), 0);
  const totalPagosBarberos = liquidacionesPagadas + anticiposPagados;
  const flujoNeto = cobrado - gastos - totalPagosBarberos;

  return {
    period: { from: from.toISOString(), to: to.toISOString(), label },
    ventas: { brutas, descuentos, netas, completadas: completed.length },
    caja: { cobrado, devuelto, porMetodo, gastos, liquidacionesPagadas, anticiposPagados, totalPagosBarberos, flujoNeto },
    comisiones: { generadas: comisionesGeneradas, pagadas: comisionesPagadas, pendientes: comisionesPendientes, pendientesConfigurar },
    resultado: {
      antesComisiones: netas,
      despuesComisiones: netas - comisionesGeneradas,
      operativoEstimado: netas - comisionesGeneradas - gastos,
    },
  };
}

/** Cartera pendiente de cobro sobre citas completadas (a cualquier fecha). */
export async function pendingReceivables() {
  const appts = await db.appointment.findMany({
    where: { status: "COMPLETED" },
    select: {
      id: true,
      code: true,
      clientName: true,
      priceSnapshot: true,
      discount: true,
      completedAt: true,
      payments: { select: { amount: true, refundedAmount: true } },
    },
    orderBy: { completedAt: "desc" },
  });
  let totalPendiente = 0;
  const rows = [] as Array<{
    appointmentId: string;
    code: string;
    client: string;
    net: number;
    pagado: number;
    pendiente: number;
    completedAt: string;
  }>;
  for (const a of appts) {
    const net = a.priceSnapshot - a.discount;
    const pagado = a.payments.reduce((s, p) => s + (p.amount - p.refundedAmount), 0);
    const pendiente = Math.max(0, net - pagado);
    if (pendiente > 0) {
      totalPendiente += pendiente;
      rows.push({
        appointmentId: a.id,
        code: a.code,
        client: a.clientName,
        net,
        pagado,
        pendiente,
        completedAt: (a.completedAt ?? new Date()).toISOString(),
      });
    }
  }
  return { totalPendiente, rows };
}

export async function barberBreakdown(from: Date, to: Date): Promise<BarberBreakdown[]> {
  const barbers = await db.user.findMany({ where: { role: "BARBER" }, orderBy: { name: "asc" } });
  const appts = await db.appointment.findMany({
    where: { status: "COMPLETED", completedAt: { gte: from, lt: to } },
    include: { payments: { select: { amount: true, refundedAmount: true } } },
  });
  const commissions = await db.commission.findMany({
    where: { createdAt: { gte: from, lt: to } },
    select: { barberId: true, calculatedAmount: true },
  });

  const map = new Map<string, BarberBreakdown>();
  for (const b of barbers) {
    map.set(b.id, { barberId: b.id, barberName: b.name, citas: 0, brutas: 0, descuentos: 0, netas: 0, comisiones: 0, negocio: 0, cobrado: 0 });
  }
  for (const a of appts) {
    const row = map.get(a.barberId);
    if (!row) continue;
    row.citas += 1;
    row.brutas += a.priceSnapshot;
    row.descuentos += a.discount;
    row.netas += a.priceSnapshot - a.discount;
    row.cobrado += a.payments.reduce((s, p) => s + (p.amount - p.refundedAmount), 0);
  }
  for (const c of commissions) {
    const row = map.get(c.barberId);
    if (!row) continue;
    row.comisiones += c.calculatedAmount;
  }
  return Array.from(map.values()).map((r) => ({ ...r, negocio: r.netas - r.comisiones }));
}

export async function serviceBreakdown(from: Date, to: Date): Promise<ServiceBreakdown[]> {
  const services = await db.service.findMany({ orderBy: { sortOrder: "asc" } });
  const appts = await db.appointment.findMany({
    where: { status: "COMPLETED", completedAt: { gte: from, lt: to } },
    include: { commission: { select: { calculatedAmount: true } } },
  });
  const map = new Map<string, ServiceBreakdown>();
  for (const s of services) {
    map.set(s.id, { serviceId: s.id, serviceName: s.name, citas: 0, brutas: 0, netas: 0, comisiones: 0 });
  }
  for (const a of appts) {
    const row = map.get(a.serviceId);
    if (!row) continue;
    row.citas += 1;
    row.brutas += a.priceSnapshot;
    row.netas += a.priceSnapshot - a.discount;
    row.comisiones += a.commission?.calculatedAmount ?? 0;
  }
  return Array.from(map.values());
}

/** Movimientos de caja del período: ingresos por pagos y egresos por gastos/anticipos/liquidaciones. */
export async function cashMovements(from: Date, to: Date): Promise<{ movements: CashMovement[]; balance: number }> {
  const [payments, expenses, advances, settlements] = await Promise.all([
    db.payment.findMany({
      where: { receivedAt: { gte: from, lt: to } },
      include: { appointment: { select: { code: true, clientName: true } } },
      orderBy: { receivedAt: "asc" },
    }),
    db.expense.findMany({ where: { spentAt: { gte: from, lt: to } }, orderBy: { spentAt: "asc" } }),
    db.commissionAdjustment.findMany({ where: { type: "ADVANCE", createdAt: { gte: from, lt: to } }, orderBy: { createdAt: "asc" } }),
    db.settlement.findMany({ where: { status: "PAID", paidAt: { gte: from, lt: to } }, orderBy: { paidAt: "asc" } }),
  ]);

  const movements: CashMovement[] = [];
  for (const p of payments) {
    const net = p.amount - p.refundedAmount;
    movements.push({
      date: p.receivedAt.toISOString(),
      kind: net >= 0 ? "INGRESO" : "EGRESO",
      concept: "Pago de cita",
      detail: `${p.appointment.code} · ${p.appointment.clientName}${p.refundedAmount > 0 ? ` (devolución ${p.refundedAmount})` : ""}`,
      amount: Math.abs(net),
      source: "PAYMENT",
      method: p.method,
    });
  }
  for (const e of expenses) {
    movements.push({
      date: e.spentAt.toISOString(),
      kind: "EGRESO",
      concept: "Gasto operativo",
      detail: e.description,
      amount: e.amount,
      source: "EXPENSE",
      method: e.method ?? undefined,
    });
  }
  for (const a of advances) {
    movements.push({
      date: a.createdAt.toISOString(),
      kind: "EGRESO",
      concept: "Anticipo a barbero",
      detail: a.reason,
      amount: Math.abs(a.amount),
      source: "ADVANCE",
    });
  }
  for (const s of settlements) {
    movements.push({
      date: (s.paidAt ?? s.updatedAt).toISOString(),
      kind: "EGRESO",
      concept: "Liquidación de comisiones",
      detail: `${s.code} · pago de comisiones`,
      amount: s.totalAmount,
      source: "SETTLEMENT",
      method: s.paymentMethod ?? undefined,
    });
  }
  movements.sort((a, b) => a.date.localeCompare(b.date));
  const balance = movements.reduce((s, m) => s + (m.kind === "INGRESO" ? m.amount : -m.amount), 0);
  return { movements, balance };
}
