"use client";
// Exportación a Excel (xlsx) de extractos del panel: pagos, caja y reportes.
import * as XLSX from "xlsx";
import { cop } from "@/lib/money";
import { fmtDateMedium, timeHMInBogota } from "@/lib/time";

function saveWorkbook(wb: XLSX.WorkBook, name: string) {
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const W = (v: string | number) => ({ v, t: typeof v === "number" ? "n" : "s" });

export type PaymentExportRow = {
  fecha: string; hora: string; cita: string; cliente: string; barbero: string; servicio: string;
  monto: number; devuelto: number; neto: number; metodo: string; estado: string; referencia: string; registro: string;
};

export function exportPaymentsExcel(rows: PaymentExportRow[], from: string, to: string) {
  const wb = XLSX.utils.book_new();
  const header = ["Fecha", "Hora", "Cita", "Cliente", "Barbero", "Servicio", "Monto", "Devuelto", "Neto", "Método", "Estado", "Referencia", "Registró"];
  const data = [header, ...rows.map((r) => [r.fecha, r.hora, r.cita, r.cliente, r.barbero, r.servicio, r.monto, r.devuelto, r.neto, r.metodo, r.estado, r.referencia, r.registro])];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = [{ wch: 12 }, { wch: 7 }, { wch: 10 }, { wch: 20 }, { wch: 18 }, { wch: 22 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws, "Pagos");
  const total = rows.reduce((s, r) => s + r.neto, 0);
  const summary = XLSX.utils.aoa_to_sheet([
    ["MELO BARBERSHOP — Extracto de pagos"],
    ["Rango", `${from} → ${to}`],
    ["Pagos", rows.length],
    ["Cobrado neto", total],
  ]);
  XLSX.utils.book_append_sheet(wb, summary, "Resumen");
  saveWorkbook(wb, `melo-pagos-${from}_${to}.xlsx`);
}

export type CashExportRow = { fecha: string; hora: string; tipo: string; concepto: string; detalle: string; valor: number; metodo: string };

export function exportCashExcel(rows: CashExportRow[], from: string, to: string, balance: number) {
  const wb = XLSX.utils.book_new();
  const data = [
    ["Fecha", "Hora", "Tipo", "Concepto", "Detalle", "Valor", "Método"],
    ...rows.map((r) => [r.fecha, r.hora, r.tipo, r.concepto, r.detalle, r.valor, r.metodo]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = [{ wch: 12 }, { wch: 7 }, { wch: 9 }, { wch: 26 }, { wch: 40 }, { wch: 12 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws, "Caja");
  const summary = XLSX.utils.aoa_to_sheet([
    ["MELO BARBERSHOP — Movimientos de caja"],
    ["Rango", `${from} → ${to}`],
    ["Movimientos", rows.length],
    ["Balance", balance],
  ]);
  XLSX.utils.book_append_sheet(wb, summary, "Resumen");
  saveWorkbook(wb, `melo-caja-${from}_${to}.xlsx`);
}

export type FullReportData = {
  periodLabel: string;
  summary: {
    ventas: { brutas: number; descuentos: number; netas: number; completadas: number };
    caja: { cobrado: number; devuelto: number; porMetodo: Record<string, number>; gastos: number; liquidacionesPagadas: number; anticiposPagados: number; totalPagosBarberos: number; flujoNeto: number };
    comisiones: { generadas: number; pagadas: number; pendientes: number; pendientesConfigurar: number };
    resultado: { antesComisiones: number; despuesComisiones: number; operativoEstimado: number };
  };
  byBarber: Array<{ barberName: string; citas: number; brutas: number; descuentos: number; netas: number; comisiones: number; negocio: number; cobrado: number }>;
  byService: Array<{ serviceName: string; citas: number; brutas: number; netas: number; comisiones: number }>;
  receivables: { totalPendiente: number; rows: Array<{ code: string; client: string; net: number; pagado: number; pendiente: number; completedAt: string }> };
};

export function exportFullReportExcel(d: FullReportData) {
  const wb = XLSX.utils.book_new();
  const s = d.summary;

  const resumen = XLSX.utils.aoa_to_sheet([
    ["MELO BARBERSHOP — Reporte financiero"],
    ["Período", d.periodLabel],
    [],
    ["CONCEPTO", "VALOR (COP)"],
    ["Ventas brutas (completadas)", s.ventas.brutas],
    ["Descuentos", -s.ventas.descuentos],
    ["Ventas netas", s.ventas.netas],
    ["Servicios completados", s.ventas.completadas],
    [],
    ["Dinero cobrado", s.caja.cobrado],
    ["Devoluciones", -s.caja.devuelto],
    ["Gastos operativos", -s.caja.gastos],
    ["Liquidaciones pagadas", -s.caja.liquidacionesPagadas],
    ["Anticipos pagados", -s.caja.anticiposPagados],
    ["Flujo de caja neto", s.caja.flujoNeto],
    [],
    ["Comisiones generadas", -s.comisiones.generadas],
    ["Comisiones pagadas", -s.comisiones.pagadas],
    ["Comisiones pendientes", -s.comisiones.pendientes],
    ["Comisiones sin configurar (n.º)", s.comisiones.pendientesConfigurar],
    [],
    ["Resultado antes de comisiones", s.resultado.antesComisiones],
    ["Resultado después de comisiones", s.resultado.despuesComisiones],
    ["Resultado operativo estimado", s.resultado.operativoEstimado],
    [],
    ["MÉTODOS DE PAGO"],
    ...Object.entries(s.caja.porMetodo).map(([m, v]) => [m, v]),
  ]);
  resumen["!cols"] = [{ wch: 36 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, resumen, "Resumen");

  const barberos = XLSX.utils.aoa_to_sheet([
    ["Barbero", "Citas", "Ventas brutas", "Descuentos", "Ventas netas", "Sus comisiones", "Del negocio", "Cobrado en sus citas"],
    ...d.byBarber.map((r) => [r.barberName, r.citas, r.brutas, r.descuentos, r.netas, r.comisiones, r.negocio, r.cobrado]),
  ]);
  XLSX.utils.book_append_sheet(wb, barberos, "Por barbero");

  const servicios = XLSX.utils.aoa_to_sheet([
    ["Servicio", "Citas", "Brutas", "Netas", "Comisiones"],
    ...d.byService.map((r) => [r.serviceName, r.citas, r.brutas, r.netas, r.comisiones]),
  ]);
  XLSX.utils.book_append_sheet(wb, servicios, "Por servicio");

  const cartera = XLSX.utils.aoa_to_sheet([
    ["Total pendiente de cobro", d.receivables.totalPendiente],
    [],
    ["Completada", "Cita", "Cliente", "Neto", "Pagado", "Pendiente"],
    ...d.receivables.rows.map((r) => [fmtDateMedium(new Date(r.completedAt)), r.code, r.client, r.net, r.pagado, r.pendiente]),
  ]);
  XLSX.utils.book_append_sheet(wb, cartera, "Cartera");

  saveWorkbook(wb, `melo-reporte-${d.periodLabel.replace(/[^\w-]+/g, "-")}.xlsx`);
}

export type CommissionExportRow = {
  completada: string; cita: string; barbero: string; servicio: string; base: number;
  regla: string; comision: number; estado: string; liquidacion: string;
};

export function exportCommissionsExcel(rows: CommissionExportRow[], title = "comisiones") {
  const wb = XLSX.utils.book_new();
  const data = [
    ["Completada", "Cita", "Barbero", "Servicio", "Base (neta)", "Regla aplicada (copia)", "Comisión", "Estado", "Liquidación"],
    ...rows.map((r) => [r.completada, r.cita, r.barbero, r.servicio, r.base, r.regla, r.comision, r.estado, r.liquidacion]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = [{ wch: 16 }, { wch: 10 }, { wch: 18 }, { wch: 22 }, { wch: 12 }, { wch: 30 }, { wch: 12 }, { wch: 18 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws, "Comisiones");
  saveWorkbook(wb, `melo-${title}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export type SettlementExportRow = { codigo: string; barbero: string; estado: string; comisiones: number; ajustes: number; total: number; aprobada: string; pagada: string; metodo: string; items: string };

export function exportSettlementsExcel(rows: SettlementExportRow[]) {
  const wb = XLSX.utils.book_new();
  const data = [
    ["Código", "Barbero", "Estado", "Comisiones", "Ajustes", "Total", "Aprobada", "Pagada", "Método", "Ítems"],
    ...rows.map((r) => [r.codigo, r.barbero, r.estado, r.comisiones, r.ajustes, r.total, r.aprobada, r.pagada, r.metodo, r.items]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = [{ wch: 10 }, { wch: 18 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 18 }, { wch: 18 }, { wch: 10 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, ws, "Liquidaciones");
  saveWorkbook(wb, `melo-liquidaciones-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export type AppointmentExportRow = { fecha: string; hora: string; cita: string; cliente: string; telefono: string; barbero: string; servicio: string; estado: string; origen: string; precio: number; descuento: number; neto: number; pagado: number; pendiente: number };

export function exportAppointmentsExcel(rows: AppointmentExportRow[], from: string, to: string) {
  const wb = XLSX.utils.book_new();
  const data = [
    ["Fecha", "Hora", "Cita", "Cliente", "Teléfono", "Barbero", "Servicio", "Estado", "Origen", "Precio", "Descuento", "Neto", "Pagado", "Pendiente"],
    ...rows.map((r) => [r.fecha, r.hora, r.cita, r.cliente, r.telefono, r.barbero, r.servicio, r.estado, r.origen, r.precio, r.descuento, r.neto, r.pagado, r.pendiente]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = [{ wch: 12 }, { wch: 7 }, { wch: 10 }, { wch: 20 }, { wch: 15 }, { wch: 18 }, { wch: 22 }, { wch: 12 }, { wch: 8 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 11 }];
  XLSX.utils.book_append_sheet(wb, ws, "Citas");
  saveWorkbook(wb, `melo-citas-${from}_${to}.xlsx`);
}

export { W as cellValue, cop, timeHMInBogota };
