"use client";
// Panel del propietario: consolidado del día y del mes + alertas (requisito D).
import { useData } from "@/lib/api";
import { cop } from "@/lib/money";
import { timeHMInBogota, fmtDateMedium } from "@/lib/time";
import { SectionTitle, StatusBadge, LoadingBlock, ErrorBlock, Chip, Money } from "@/components/melo/ui";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Wallet, Percent, Receipt, TrendingUp, BadgeAlert, MessageSquareOff, CheckCircle2, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";

type Summary = {
  period: { label: string };
  ventas: { brutas: number; descuentos: number; netas: number; completadas: number };
  caja: { cobrado: number; gastos: number; totalPagosBarberos: number; flujoNeto: number };
  comisiones: { generadas: number; pagadas: number; pendientes: number; pendientesConfigurar: number };
  resultado: { antesComisiones: number; despuesComisiones: number; operativoEstimado: number };
};

export function OwnerDashboard({ go }: { go: (v: string) => void }) {
  const q = useData<{
    role: string;
    today: string;
    todayAppointments: Array<{ id: string; code: string; status: string; startTime: string; clientName: string; service: { name: string }; barber: { name: string } }>;
    daySummary: Summary;
    monthSummary: Summary;
    receivables: { totalPendiente: number };
    alerts: { comisionesSinConfigurar: number; citasSinConfirmar: number; whatsapp: string };
  }>("/api/dashboard");

  if (q.loading) return <LoadingBlock label="Cargando panel…" />;
  if (q.error || !q.data) return <ErrorBlock message={q.error ?? "Sin datos"} onRetry={q.reload} />;
  const d = q.data;

  return (
    <div>
      <SectionTitle title="Panel del propietario" sub="Consolidado del negocio: hoy y mes en curso. Las métricas distinguen ventas de cada barbero, dinero cobrado y lo que queda para el negocio tras comisiones y gastos." />

      {/* alertas */}
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <button onClick={() => go("commissions")} className={cn("rounded-xl border p-4 text-left transition hover:shadow-md", d.alerts.comisionesSinConfigurar > 0 ? "border-warn/50 bg-warn/10" : "border-good/40 bg-good/5")}>
          <div className="flex items-center gap-2 font-semibold text-sm">
            {d.alerts.comisionesSinConfigurar > 0 ? <BadgeAlert className="h-4 w-4 text-warn" /> : <CheckCircle2 className="h-4 w-4 text-good" />}
            Comisiones sin configurar
          </div>
          <div className="mt-1 font-display text-2xl font-bold">{d.alerts.comisionesSinConfigurar}</div>
          <div className="text-xs text-ink-soft">{d.alerts.comisionesSinConfigurar > 0 ? "Definelas desde Comisiones" : "Todo en orden"}</div>
        </button>
        <button onClick={() => go("agenda")} className="rounded-xl border border-brass/40 bg-brass/5 p-4 text-left transition hover:shadow-md">
          <div className="flex items-center gap-2 font-semibold text-sm"><CalendarDays className="h-4 w-4 text-brass-dark" /> Citas de hoy sin confirmar</div>
          <div className="mt-1 font-display text-2xl font-bold">{d.alerts.citasSinConfirmar}</div>
          <div className="text-xs text-ink-soft">Revísalas en la agenda</div>
        </button>
        <div className={cn("rounded-xl border p-4", d.alerts.whatsapp === "CONFIGURED" ? "border-good/40 bg-good/5" : "border-ink/15 bg-cream")}>
          <div className="flex items-center gap-2 font-semibold text-sm">
            <MessageSquareOff className={cn("h-4 w-4", d.alerts.whatsapp === "CONFIGURED" ? "text-good" : "text-ink-soft")} />
            WhatsApp
          </div>
          <div className="mt-1 text-sm font-medium">
            {d.alerts.whatsapp === "CONFIGURED" ? "Integración activa" : "Pendiente de configuración"}
          </div>
          <div className="text-xs text-ink-soft">
            {d.alerts.whatsapp === "CONFIGURED" ? "Confirmaciones y recordatorios en camino" : "La agenda funciona igual; configúrala en Configuración"}
          </div>
        </div>
      </div>

      {/* hoy */}
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <MetricCard title="Hoy · ventas netas (tras descuentos)" value={d.daySummary.ventas.netas} sub={`Brutas ${cop(d.daySummary.ventas.brutas)} · Descuentos ${cop(d.daySummary.ventas.descuentos)} · ${d.daySummary.ventas.completadas} completadas`} icon={<TrendingUp className="h-5 w-5" />} />
        <MetricCard title="Hoy · dinero cobrado" value={d.daySummary.caja.cobrado} sub={`Flujo del día ${cop(d.daySummary.caja.flujoNeto)} (cobrado − gastos − pagos a barberos)`} icon={<Wallet className="h-5 w-5" />} />
        <MetricCard title="Mes · resultado operativo estimado" value={d.monthSummary.resultado.operativoEstimado} sub={`Netas ${cop(d.monthSummary.ventas.netas)} − comisiones ${cop(d.monthSummary.comisiones.generadas)} − gastos ${cop(d.monthSummary.caja.gastos)} (una sola vez)`} icon={<Receipt className="h-5 w-5" />} />
        <MetricCard title="Comisiones pendientes de liquidar (total)" value={d.monthSummary.comisiones.pendientes} sub={`Generadas en el mes ${cop(d.monthSummary.comisiones.generadas)} · Pagadas ${cop(d.monthSummary.comisiones.pagadas)}`} icon={<Percent className="h-5 w-5" />} />
      </div>

      <Card className="border-ink/10 bg-ivory">
        <CardHeader className="pb-2">
          <CardTitle className="font-display text-lg">Citas de hoy ({d.todayAppointments.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {d.todayAppointments.length === 0 ? (
            <div className="rounded-xl border border-dashed border-ink/15 px-4 py-8 text-center text-sm text-ink-soft">Sin citas para hoy.</div>
          ) : (
            <div className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1 nice-scroll">
              {d.todayAppointments.map((a) => (
                <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-ink/10 bg-cream px-3 py-2 text-sm">
                  <span className="font-semibold tabular-nums">{timeHMInBogota(new Date(a.startTime))}</span>
                  <StatusBadge status={a.status} />
                  <span className="text-ink-soft">{a.service.name} · {a.clientName}</span>
                  <Chip className="ml-auto">{a.barber.name}</Chip>
                  <Chip>{a.code}</Chip>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg bg-cream p-3">
              <span className="text-ink-soft">Cartera pendiente de cobro: </span>
              <b><Money value={d.receivables.totalPendiente} /></b>
            </div>
            <div className="rounded-lg bg-cream p-3">
              <span className="text-ink-soft">Mes · antes de comisiones: </span>
              <b><Money value={d.monthSummary.resultado.antesComisiones} /></b>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({ title, value, sub, icon }: { title: string; value: number; sub: string; icon: React.ReactNode }) {
  const negative = value < 0;
  return (
    <Card className={cn("border-ink/10 bg-ivory", negative && "border-melo/30")}>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
          {icon} {title}
        </div>
        <div className={cn("mt-2 font-display text-3xl font-bold", negative ? "text-melo-dark" : "text-ink")}>
          {cop(value)}
        </div>
        <div className="mt-1 text-xs text-ink-soft">{sub}</div>
      </CardContent>
    </Card>
  );
}

export function BarberDashboard() {
  const q = useData<{
    role: string;
    today: string;
    myAppointments: Array<{ id: string; code: string; status: string; startTime: string; clientName: string; service: { name: string; durationMin: number } }>;
    alerts: { comisionesPendientes: number };
  }>("/api/dashboard");

  if (q.loading) return <LoadingBlock label="Cargando mi día…" />;
  if (q.error || !q.data) return <ErrorBlock message={q.error ?? "Sin datos"} onRetry={q.reload} />;
  const d = q.data;

  return (
    <div>
      <SectionTitle title="Mi día" sub="Tu agenda de hoy y tus comisiones pendientes. No puedes ver la información financiera de otros barberos salvo permiso expreso del propietario." />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-brass/40 bg-brass/5 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Citas de hoy</div>
          <div className="mt-1 font-display text-3xl font-bold">{d.myAppointments.length}</div>
        </div>
        <div className="rounded-xl border border-ink/10 bg-ivory p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Comisiones pendientes de liquidar</div>
          <div className="mt-1 font-display text-3xl font-bold">{d.alerts.comisionesPendientes}</div>
          <div className="mt-1 text-xs text-ink-soft">Se pagan mediante liquidaciones aprobadas por el propietario.</div>
        </div>
        <div className="rounded-xl border border-ink/10 bg-ivory p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Próximas</div>
          <div className="mt-1 font-display text-3xl font-bold">
            {d.myAppointments.filter((a) => a.status === "RESERVED" || a.status === "CONFIRMED").length}
          </div>
          <div className="mt-1 text-xs text-ink-soft">{fmtDateMedium(new Date())}</div>
        </div>
      </div>
      {d.myAppointments.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink/15 px-4 py-10 text-center text-ink-soft">Hoy no tienes citas. ¡Buen momento para ordenar tu estación!</div>
      ) : (
        <div className="grid gap-2">
          {d.myAppointments.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-ink/10 bg-ivory px-4 py-3 text-sm">
              <span className="font-semibold tabular-nums">{timeHMInBogota(new Date(a.startTime))}</span>
              <StatusBadge status={a.status} />
              <span className="text-ink-soft">{a.service.name} · {a.clientName} · {a.service.durationMin} min</span>
              <Chip className="ml-auto">{a.code}</Chip>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
