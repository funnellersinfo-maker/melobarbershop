"use client";
// Reportes del propietario con exportación a Excel multi-hoja.
import { useEffect, useMemo, useState } from "react";
import { cop } from "@/lib/money";
import { fmtDateMedium } from "@/lib/time";
import { getDB } from "@/lib/store";
import { periodSummary, barberBreakdown, serviceBreakdown, pendingReceivables, periodRange } from "@/lib/engines/finance";
import { SectionTitle, EmptyState, Chip } from "@/components/melo/ui";
import { exportFullReportExcel } from "@/lib/excel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart3, Users, Scissors, Wallet, FileSpreadsheet } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

export function ReportsView() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const h = () => setTick((n) => n + 1);
    window.addEventListener("melo:db-changed", h);
    return () => window.removeEventListener("melo:db-changed", h);
  }, []);

  const today = new Date();
  const iso = (d: Date) => dateKeyLocal(d);
  const [preset, setPreset] = useState<"today" | "week" | "month" | "custom">("month");
  const [from, setFrom] = useState(iso(new Date(today.getTime() - 29 * 24 * 3600 * 1000)));
  const [to, setTo] = useState(iso(today));

  const db = getDB();
  const range = useMemo(() => periodRange(preset, from, to), [preset, from, to, tick]);
  const summary = useMemo(() => periodSummary(db, range.from, range.to, range.label), [range, tick]);
  const byBarber = useMemo(() => barberBreakdown(db, range.from, range.to), [range, tick]);
  const byService = useMemo(() => serviceBreakdown(db, range.from, range.to), [range, tick]);
  const receivables = useMemo(() => pendingReceivables(db), [tick]);

  function exportExcel() {
    exportFullReportExcel({
      periodLabel: range.label,
      summary,
      byBarber,
      byService,
      receivables,
    });
    toast({ title: "Excel generado", description: "Reporte completo con resumen, barberos, servicios y cartera." });
  }

  return (
    <div>
      <SectionTitle
        title="Reportes"
        sub="Diarios, semanales y mensuales. Ventas y comisiones por fecha de completado; caja por fecha de transacción; cada concepto se descuenta una sola vez."
        right={
          <Button variant="outline" onClick={exportExcel} className="border-good/50 text-good hover:bg-good/10">
            <FileSpreadsheet className="mr-1 h-4 w-4" /> Exportar Excel completo
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
        <Chip className="ml-auto">{range.label}</Chip>
      </div>

      <Tabs defaultValue="resumen">
        <TabsList className="bg-ivory">
          <TabsTrigger value="resumen"><BarChart3 className="mr-1 h-4 w-4" /> Resumen</TabsTrigger>
          <TabsTrigger value="porBarbero"><Users className="mr-1 h-4 w-4" /> Por barbero</TabsTrigger>
          <TabsTrigger value="porServicio"><Scissors className="mr-1 h-4 w-4" /> Por servicio</TabsTrigger>
          <TabsTrigger value="cartera"><Wallet className="mr-1 h-4 w-4" /> Cartera</TabsTrigger>
        </TabsList>

        <TabsContent value="resumen" className="mt-4">
          <SummaryGrid summary={summary} />
        </TabsContent>

        <TabsContent value="porBarbero" className="mt-4">
          {byBarber.length === 0 ? <EmptyState title="Sin datos en el período" /> : (
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
                  {byBarber.map((r) => (
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
                “Del negocio” = ventas netas del barbero − sus comisiones. Así se distingue lo que vende cada barbero de lo que realmente queda para el negocio.
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="porServicio" className="mt-4">
          {byService.length > 0 ? (
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
                  {byService.map((r) => (
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
          <div className="mb-4 rounded-xl border border-warn/40 bg-warn/5 p-4">
            <div className="text-xs uppercase tracking-wide text-ink-soft">Total pendiente de cobro (todas las fechas)</div>
            <div className="font-display text-3xl font-bold text-warn">{cop(receivables.totalPendiente)}</div>
          </div>
          {receivables.rows.length === 0 ? (
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
                  {receivables.rows.map((r) => (
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
        </TabsContent>
      </Tabs>
    </div>
  );
}

function dateKeyLocal(d: Date): string {
  const p = new Date(d.getTime() - 5 * 3600 * 1000);
  return `${p.getUTCFullYear()}-${String(p.getUTCMonth() + 1).padStart(2, "0")}-${String(p.getUTCDate()).padStart(2, "0")}`;
}

function SummaryGrid({ summary }: { summary: ReturnType<typeof periodSummary> }) {
  const s = summary;
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
        <div><b className="text-ink">Convenciones:</b> ventas y comisiones por fecha de completado; caja por fecha de transacción.</div>
        <div>El resultado operativo descuenta una sola vez comisiones y gastos. Los pagos a barberos solo afectan la caja.</div>
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
