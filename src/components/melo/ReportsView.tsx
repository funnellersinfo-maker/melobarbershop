"use client";
// Reportes del propietario: resumen financiero, desglose por barbero/servicio y
// cartera pendiente (requisito D: distinguir ventas por barbero vs dinero del negocio).
import { useState } from "react";
import { useData } from "@/lib/api";
import { cop } from "@/lib/money";
import { fmtDateMedium } from "@/lib/time";
import { SectionTitle, LoadingBlock, ErrorBlock, EmptyState, Chip } from "@/components/melo/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart3, Users, Scissors, Wallet, FileDown } from "lucide-react";
import { cn } from "@/lib/utils";

type SummaryResponse = {
  summary: {
    period: { label: string };
    ventas: { brutas: number; descuentos: number; netas: number; completadas: number };
    caja: { cobrado: number; devuelto: number; porMetodo: Record<string, number>; gastos: number; liquidacionesPagadas: number; anticiposPagados: number; totalPagosBarberos: number; flujoNeto: number };
    comisiones: { generadas: number; pagadas: number; pendientes: number; pendientesConfigurar: number };
    resultado: { antesComisiones: number; despuesComisiones: number; operativoEstimado: number };
  };
  receivables: { totalPendiente: number; rows: Array<{ code: string; client: string; net: number; pagado: number; pendiente: number; completedAt: string }> };
  conventions: { ventasYComisiones: string; caja: string; resultado: string };
};

type BreakdownResponse = {
  period: string;
  byBarber: Array<{ barberId: string; barberName: string; citas: number; brutas: number; descuentos: number; netas: number; comisiones: number; negocio: number; cobrado: number }>;
  byService: Array<{ serviceId: string; serviceName: string; citas: number; brutas: number; netas: number; comisiones: number }>;
};

export function ReportsView() {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const lastMonth = new Date(today.getTime() - 29 * 24 * 3600 * 1000);
  const [preset, setPreset] = useState<"today" | "week" | "month" | "custom">("month");
  const [from, setFrom] = useState(iso(lastMonth));
  const [to, setTo] = useState(iso(today));

  const query = preset === "custom" ? `from=${from}&to=${to}` : `preset=${preset}`;
  const sumQ = useData<SummaryResponse>(`/api/reports/summary?${query}`, [query]);
  const brkQ = useData<BreakdownResponse>(`/api/reports/breakdown?${query}`, [query]);

  function exportCSV() {
    const s = sumQ.data?.summary;
    const b = brkQ.data;
    if (!s || !b) return;
    const lines: string[] = [];
    lines.push(`MELO BARBERSHOP; Reporte; ${s.period.label}`);
    lines.push("");
    lines.push("CONCEPTO;VALOR (COP)");
    lines.push(`Ventas brutas;${s.ventas.brutas}`);
    lines.push(`Descuentos;${s.ventas.descuentos}`);
    lines.push(`Ventas netas;${s.ventas.netas}`);
    lines.push(`Dinero cobrado;${s.caja.cobrado}`);
    lines.push(`Devoluciones;${s.caja.devuelto}`);
    lines.push(`Comisiones generadas;${s.comisiones.generadas}`);
    lines.push(`Comisiones pagadas;${s.comisiones.pagadas}`);
    lines.push(`Comisiones pendientes;${s.comisiones.pendientes}`);
    lines.push(`Gastos;${s.caja.gastos}`);
    lines.push(`Pagos a barberos;${s.caja.totalPagosBarberos}`);
    lines.push(`Flujo de caja;${s.caja.flujoNeto}`);
    lines.push(`Resultado antes de comisiones;${s.resultado.antesComisiones}`);
    lines.push(`Resultado despues de comisiones;${s.resultado.despuesComisiones}`);
    lines.push(`Resultado operativo estimado;${s.resultado.operativoEstimado}`);
    lines.push("");
    lines.push("POR BARBERO");
    lines.push("Barbero;Citas;Brutas;Descuentos;Netas;Comisiones;Del negocio;Cobrado");
    for (const r of b.byBarber) lines.push(`${r.barberName};${r.citas};${r.brutas};${r.descuentos};${r.netas};${r.comisiones};${r.negocio};${r.cobrado}`);
    lines.push("");
    lines.push("POR SERVICIO");
    lines.push("Servicio;Citas;Brutas;Netas;Comisiones");
    for (const r of b.byService) lines.push(`${r.serviceName};${r.citas};${r.brutas};${r.netas};${r.comisiones}`);
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `melo-reporte-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <SectionTitle
        title="Reportes"
        sub="Diarios, semanales y mensuales. Convenciones claras: ventas y comisiones por fecha de completado; caja por fecha de transacción; cada concepto se descuenta una sola vez."
        right={
          <Button variant="outline" onClick={exportCSV} className="border-brass/50 text-brass-dark hover:bg-brass/10">
            <FileDown className="mr-1 h-4 w-4" /> Exportar CSV
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <Label className="text-xs">Período</Label>
          <Select value={preset} onValueChange={(v) => setPreset(v as "today" | "week" | "month" | "custom")}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Hoy (diario)</SelectItem>
              <SelectItem value="week">Semana actual</SelectItem>
              <SelectItem value="month">Mes actual</SelectItem>
              <SelectItem value="custom">Personalizado</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {preset === "custom" ? (
          <>
            <div className="grid gap-1"><Label className="text-xs">Desde</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></div>
            <div className="grid gap-1"><Label className="text-xs">Hasta</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
          </>
        ) : null}
        {sumQ.data ? <Chip className="ml-auto">{sumQ.data.summary.period.label}</Chip> : null}
      </div>

      <Tabs defaultValue="resumen">
        <TabsList className="bg-ivory">
          <TabsTrigger value="resumen"><BarChart3 className="mr-1 h-4 w-4" /> Resumen</TabsTrigger>
          <TabsTrigger value="porBarbero"><Users className="mr-1 h-4 w-4" /> Por barbero</TabsTrigger>
          <TabsTrigger value="porServicio"><Scissors className="mr-1 h-4 w-4" /> Por servicio</TabsTrigger>
          <TabsTrigger value="cartera"><Wallet className="mr-1 h-4 w-4" /> Cartera</TabsTrigger>
        </TabsList>

        <TabsContent value="resumen" className="mt-4">
          {sumQ.loading ? <LoadingBlock /> : sumQ.error ? <ErrorBlock message={sumQ.error} onRetry={sumQ.reload} /> : null}
          {sumQ.data ? <SummaryGrid data={sumQ.data} /> : null}
        </TabsContent>

        <TabsContent value="porBarbero" className="mt-4">
          {brkQ.loading ? <LoadingBlock /> : brkQ.error ? <ErrorBlock message={brkQ.error} onRetry={brkQ.reload} /> : null}
          {brkQ.data && brkQ.data.byBarber.length === 0 ? <EmptyState title="Sin datos en el período" /> : null}
          {brkQ.data && brkQ.data.byBarber.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-ink/10 bg-ivory">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Barbero</TableHead>
                    <TableHead className="text-right">Citas</TableHead>
                    <TableHead className="text-right">Ventas brutas</TableHead>
                    <TableHead className="text-right">Descuentos</TableHead>
                    <TableHead className="text-right">Ventas netas</TableHead>
                    <TableHead className="text-right">Sus comisiones</TableHead>
                    <TableHead className="text-right">Del negocio</TableHead>
                    <TableHead className="text-right">Cobrado en sus citas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {brkQ.data.byBarber.map((r) => (
                    <TableRow key={r.barberId}>
                      <TableCell className="font-medium">{r.barberName}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.citas}</TableCell>
                      <TableCell className="text-right tabular-nums">{cop(r.brutas)}</TableCell>
                      <TableCell className="text-right tabular-nums">{cop(r.descuentos)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{cop(r.netas)}</TableCell>
                      <TableCell className="text-right tabular-nums text-warn">{cop(r.comisiones)}</TableCell>
                      <TableCell className="text-right font-bold tabular-nums text-good">{cop(r.negocio)}</TableCell>
                      <TableCell className="text-right tabular-nums">{cop(r.cobrado)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="px-4 py-3 text-xs text-ink-soft">
                “Del negocio” = ventas netas del barbero − sus comisiones. Así se distingue lo que vende cada barbero de lo que realmente queda para el negocio (requisito D).
              </div>
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="porServicio" className="mt-4">
          {brkQ.loading ? <LoadingBlock /> : null}
          {brkQ.data && brkQ.data.byService.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-ink/10 bg-ivory">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Servicio</TableHead>
                    <TableHead className="text-right">Citas</TableHead>
                    <TableHead className="text-right">Brutas</TableHead>
                    <TableHead className="text-right">Netas</TableHead>
                    <TableHead className="text-right">Comisiones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {brkQ.data.byService.map((r) => (
                    <TableRow key={r.serviceId}>
                      <TableCell className="font-medium">{r.serviceName}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.citas}</TableCell>
                      <TableCell className="text-right tabular-nums">{cop(r.brutas)}</TableCell>
                      <TableCell className="text-right tabular-nums">{cop(r.netas)}</TableCell>
                      <TableCell className="text-right tabular-nums">{cop(r.comisiones)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="cartera" className="mt-4">
          {sumQ.loading ? <LoadingBlock /> : null}
          {sumQ.data ? (
            <>
              <div className="mb-4 rounded-xl border border-warn/40 bg-warn/5 p-4">
                <div className="text-xs uppercase tracking-wide text-ink-soft">Total pendiente de cobro (todas las fechas)</div>
                <div className="font-display text-3xl font-bold text-warn">{cop(sumQ.data.receivables.totalPendiente)}</div>
              </div>
              {sumQ.data.receivables.rows.length === 0 ? (
                <EmptyState title="Cartera al día" sub="No hay citas completadas con saldo pendiente." />
              ) : (
                <div className="overflow-x-auto rounded-xl border border-ink/10 bg-ivory">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Completada</TableHead>
                        <TableHead>Cita</TableHead>
                        <TableHead>Cliente</TableHead>
                        <TableHead className="text-right">Neto</TableHead>
                        <TableHead className="text-right">Pagado</TableHead>
                        <TableHead className="text-right">Pendiente</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sumQ.data.receivables.rows.map((r) => (
                        <TableRow key={r.code}>
                          <TableCell className="text-sm">{fmtDateMedium(new Date(r.completedAt))}</TableCell>
                          <TableCell className="font-medium">{r.code}</TableCell>
                          <TableCell className="text-sm">{r.client}</TableCell>
                          <TableCell className="text-right tabular-nums">{cop(r.net)}</TableCell>
                          <TableCell className="text-right tabular-nums text-good">{cop(r.pagado)}</TableCell>
                          <TableCell className="text-right font-bold tabular-nums text-warn">{cop(r.pendiente)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SummaryGrid({ data }: { data: SummaryResponse }) {
  const s = data.summary;
  const rows: Array<{ label: string; value: number; cls?: string; hint?: string }> = [
    { label: "Ventas brutas (completadas)", value: s.ventas.brutas, hint: `${s.ventas.completadas} servicios` },
    { label: "Descuentos", value: -s.ventas.descuentos, cls: "text-melo-dark" },
    { label: "Ventas netas", value: s.ventas.netas, cls: "font-bold", hint: "antes de comisiones y gastos" },
    { label: "Dinero efectivamente cobrado", value: s.caja.cobrado, hint: `devoluciones: ${cop(s.caja.devuelto)}` },
    { label: "Comisiones generadas", value: -s.comisiones.generadas, cls: "text-warn", hint: `pagadas ${cop(s.comisiones.pagadas)} · pendientes ${cop(s.comisiones.pendientes)}` },
    { label: "Gastos operativos", value: -s.caja.gastos, cls: "text-melo-dark", hint: `pagos a barberos: ${cop(s.caja.totalPagosBarberos)}` },
    { label: "Flujo de caja del período", value: s.caja.flujoNeto, cls: s.caja.flujoNeto >= 0 ? "text-good" : "text-melo-dark", hint: "cobrado − gastos − pagos a barberos" },
    { label: "Resultado después de comisiones", value: s.resultado.despuesComisiones, hint: "netas − comisiones" },
    { label: "Resultado operativo estimado", value: s.resultado.operativoEstimado, cls: "font-bold", hint: "netas − comisiones − gastos (una sola vez)" },
  ];
  return (
    <div>
      <div className="mb-4 grid gap-2 rounded-xl border border-ink/10 bg-ivory p-4 text-xs text-ink-soft">
        <div><b className="text-ink">Convenciones:</b> {data.conventions.ventasYComisiones}. {data.conventions.caja}.</div>
        <div>{data.conventions.resultado}. Nada se descuenta dos veces: los pagos a barberos solo afectan la caja, no el resultado operativo.</div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => (
          <div key={r.label} className="rounded-2xl border border-ink/10 bg-ivory p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{r.label}</div>
            <div className={cn("mt-1 font-display text-2xl tabular-nums", r.cls ?? "text-ink")}>
              {r.value < 0 ? `− ${cop(Math.abs(r.value))}` : cop(r.value)}
            </div>
            {r.hint ? <div className="mt-1 text-xs text-ink-soft">{r.hint}</div> : null}
          </div>
        ))}
      </div>
      <div className="mt-4 text-xs text-ink-soft">
        Métodos de pago:{" "}
        {Object.entries(s.caja.porMetodo).map(([m, v]) => `${m} ${cop(v)}`).join(" · ") || "sin pagos en el período"}
      </div>
    </div>
  );
}
