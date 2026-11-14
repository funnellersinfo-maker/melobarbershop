"use client";
// Paneles de resumen: propietario (consolidado) y barbero (métricas simples + roadmap).
import { useEffect, useMemo, useState } from "react";
import { getDB, getAdminData, type SessionUser } from "@/lib/store";
import { cop } from "@/lib/money";
import { timeHMInBogota, fmtDateMedium, dateKeyInBogota } from "@/lib/time";
import { periodSummary, pendingReceivables } from "@/lib/engines/finance";
import { SectionTitle, StatusBadge, Chip, Money } from "@/components/melo/ui";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Wallet, Percent, Receipt, TrendingUp, BadgeAlert, CheckCircle2, CalendarDays, Scissors, Star, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";

type Summary = {
  period: { label: string };
  ventas: { brutas: number; descuentos: number; netas: number; completadas: number };
  caja: { cobrado: number; gastos: number; totalPagosBarberos: number; flujoNeto: number };
  comisiones: { generadas: number; pagadas: number; pendientes: number; pendientesConfigurar: number };
  resultado: { antesComisiones: number; despuesComisiones: number; operativoEstimado: number };
};

// ---------- niveles del roadmap del barbero ----------
export const LEVELS = [
  { name: "Aprendiz", min: 0, icon: "🌱" },
  { name: "Barbero", min: 10, icon: "✂️" },
  { name: "Senior", min: 30, icon: "💈" },
  { name: "Maestro", min: 60, icon: "🏆" },
  { name: "Leyenda", min: 100, icon: "👑" },
];

export function barberLevel(servicesDone: number) {
  let current = LEVELS[0];
  let next: (typeof LEVELS)[number] | null = null;
  for (let i = 0; i < LEVELS.length; i++) {
    if (servicesDone >= LEVELS[i].min) {
      current = LEVELS[i];
      next = LEVELS[i + 1] ?? null;
    }
  }
  const progress = next ? Math.round(((servicesDone - current.min) / (next.min - current.min)) * 100) : 100;
  return { current, next, progress: Math.min(100, Math.max(0, progress)) };
}

export function OwnerDashboard({ go }: { go: (v: string) => void }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const h = () => setTick((n) => n + 1);
    window.addEventListener("melo:db-changed", h);
    return () => window.removeEventListener("melo:db-changed", h);
  }, []);
  const db = getDB();
  const admin = getAdminData();

  const todayK = dateKeyInBogota(new Date());
  const now = new Date();
  const dayStart = new Date(`${todayK}T00:00:00-05:00`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), new Date(now.getTime() - 5 * 3600 * 1000).getUTCMonth(), 1, 5));

  const daySummary = useMemo(() => periodSummary(db, dayStart, dayEnd, "Hoy"), [tick, db]);
  const monthSummary = useMemo(() => periodSummary(db, monthStart, dayEnd, "Mes"), [tick, db]);
  const receivables = useMemo(() => pendingReceivables(db), [tick, db]);
  const todayAppointments = db.appointments
    .filter((a) => a.startTime >= dayStart.toISOString() && a.startTime < dayEnd.toISOString())
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  const sinConfigurar = db.commissions.filter((c) => c.status === "PENDING_CONFIG").length;
  const citasSinConfirmar = todayAppointments.filter((a) => a.status === "RESERVED").length;
  const pendingComments = db.comments.filter((c) => !c.hidden).length;

  return (
    <div>
      <SectionTitle title="Panel del propietario" sub="Consolidado del negocio: hoy y mes en curso. Ventas por barbero, dinero cobrado y lo que queda para el negocio tras comisiones y gastos." />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <button onClick={() => go("commissions")} className={cn("rounded-xl border p-4 text-left transition hover:shadow-md", sinConfigurar > 0 ? "border-warn/50 bg-warn/10" : "border-good/40 bg-good/5")}>
          <div className="flex items-center gap-2 font-semibold text-sm">
            {sinConfigurar > 0 ? <BadgeAlert className="h-4 w-4 text-warn" /> : <CheckCircle2 className="h-4 w-4 text-good" />}
            Comisiones sin configurar
          </div>
          <div className="mt-1 font-display text-2xl font-bold">{sinConfigurar}</div>
          <div className="text-xs text-ink-soft">{sinConfigurar > 0 ? "Defínelas desde Comisiones" : "Todo en orden"}</div>
        </button>
        <button onClick={() => go("agenda")} className="rounded-xl border border-brass/40 bg-brass/5 p-4 text-left transition hover:shadow-md">
          <div className="flex items-center gap-2 font-semibold text-sm"><CalendarDays className="h-4 w-4 text-brass-dark" /> Citas de hoy sin confirmar</div>
          <div className="mt-1 font-display text-2xl font-bold">{citasSinConfirmar}</div>
          <div className="text-xs text-ink-soft">Revísalas en la agenda</div>
        </button>
        <button onClick={() => go("social")} className="rounded-xl border border-ink/15 bg-cream p-4 text-left transition hover:shadow-md">
          <div className="flex items-center gap-2 font-semibold text-sm"><Star className="h-4 w-4 text-brass-dark" /> Comunidad</div>
          <div className="mt-1 text-sm font-medium">{db.posts.filter((p) => !p.hidden).length} publicaciones</div>
          <div className="text-xs text-ink-soft">{pendingComments} comentarios de clientes · modéralos en Comunidad</div>
        </button>
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <MetricCard title="Hoy · ventas netas (tras descuentos)" value={daySummary.ventas.netas} sub={`Brutas ${cop(daySummary.ventas.brutas)} · Descuentos ${cop(daySummary.ventas.descuentos)} · ${daySummary.ventas.completadas} completadas`} icon={<TrendingUp className="h-5 w-5" />} />
        <MetricCard title="Hoy · dinero cobrado" value={daySummary.caja.cobrado} sub={`Flujo del día ${cop(daySummary.caja.flujoNeto)} (cobrado − gastos − pagos a barberos)`} icon={<Wallet className="h-5 w-5" />} />
        <MetricCard title="Mes · resultado operativo estimado" value={monthSummary.resultado.operativoEstimado} sub={`Netas ${cop(monthSummary.ventas.netas)} − comisiones ${cop(monthSummary.comisiones.generadas)} − gastos ${cop(monthSummary.caja.gastos)} (una sola vez)`} icon={<Receipt className="h-5 w-5" />} />
        <MetricCard title="Comisiones pendientes de liquidar (mes)" value={monthSummary.comisiones.pendientes} sub={`Generadas en el mes ${cop(monthSummary.comisiones.generadas)} · Pagadas ${cop(monthSummary.comisiones.pagadas)}`} icon={<Percent className="h-5 w-5" />} />
      </div>

      <Card className="border-ink/10 bg-ivory">
        <CardHeader className="pb-2">
          <CardTitle className="font-display text-lg">Citas de hoy ({todayAppointments.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {todayAppointments.length === 0 ? (
            <div className="rounded-xl border border-dashed border-ink/15 px-4 py-8 text-center text-sm text-ink-soft">Sin citas para hoy.</div>
          ) : (
            <div className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1 nice-scroll">
              {todayAppointments.map((a) => {
                const barber = db.barbers.find((b) => b.id === a.barberId);
                const service = db.services.find((s) => s.id === a.serviceId);
                return (
                  <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-ink/10 bg-cream px-3 py-2 text-sm">
                    <span className="font-semibold tabular-nums">{timeHMInBogota(new Date(a.startTime))}</span>
                    <StatusBadge status={a.status} />
                    <span className="text-ink-soft">{service?.name} · {a.clientName}</span>
                    <Chip className="ml-auto">{barber?.name ?? "—"}</Chip>
                    <Chip>{a.code}</Chip>
                  </div>
                );
              })}
            </div>
          )}
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg bg-cream p-3">
              <span className="text-ink-soft">Cartera pendiente de cobro: </span>
              <b><Money value={receivables.totalPendiente} /></b>
            </div>
            <div className="rounded-lg bg-cream p-3">
              <span className="text-ink-soft">Mes · antes de comisiones: </span>
              <b><Money value={monthSummary.resultado.antesComisiones} /></b>
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

export function BarberDashboard({ user }: { user: SessionUser }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const h = () => setTick((n) => n + 1);
    window.addEventListener("melo:db-changed", h);
    return () => window.removeEventListener("melo:db-changed", h);
  }, []);
  const db = getDB();
  const barber = db.barbers.find((b) => b.id === user.id);
  const todayK = dateKeyInBogota(new Date());
  const dayStart = new Date(`${todayK}T00:00:00-05:00`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);

  const myAppointments = db.appointments
    .filter((a) => a.barberId === user.id && a.startTime >= dayStart.toISOString() && a.startTime < dayEnd.toISOString())
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  const myCommissions = db.commissions.filter((c) => c.barberId === user.id);
  const pendientes = myCommissions.filter((c) => c.status === "PENDING_PAYMENT").reduce((s, c) => s + c.calculatedAmount, 0);
  const pagadas = myCommissions.filter((c) => c.status === "PAID").reduce((s, c) => s + c.calculatedAmount, 0);

  // métricas simples del mes
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date(Date.now() - 5 * 3600 * 1000).getUTCMonth(), 1, 5));
  const completadasMes = db.appointments.filter((a) => a.barberId === user.id && a.status === "COMPLETED" && a.completedAt && a.completedAt >= monthStart.toISOString());
  const ventasMes = completadasMes.reduce((s, a) => s + a.priceSnapshot - a.discount, 0);
  const totalCompletadas = db.appointments.filter((a) => a.barberId === user.id && a.status === "COMPLETED").length;

  // reseñas y roadmap
  const reviews = db.comments.filter((c) => c.barberId === user.id && c.postId === null && !c.hidden && c.rating);
  const avg = reviews.length ? Math.round((reviews.reduce((s, c) => s + (c.rating ?? 0), 0) / reviews.length) * 10) / 10 : 0;
  const likes = db.posts.filter((p) => p.barberId === user.id && !p.hidden).reduce((s, p) => s + p.likes.length, 0);
  const lvl = barberLevel(totalCompletadas);

  return (
    <div>
      <SectionTitle title={`Hola, ${user.name.split(" ")[0]} 👋`} sub="Tu día de hoy, tus ganancias y tu progreso. ¡A seguir creciendo!" />

      {/* roadmap */}
      <div className="mb-6 rounded-2xl border border-brass/40 bg-gradient-to-r from-brass/10 to-ivory p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-4xl">{lvl.current.icon}</span>
            <div>
              <div className="text-xs uppercase tracking-wide text-ink-soft">Tu nivel</div>
              <div className="font-display text-2xl font-bold">{lvl.current.name}</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Chip className="border-brass/40 text-brass-dark"><Star className="h-3.5 w-3.5 fill-brass" /> {avg || "—"} / 5 ({reviews.length} reseñas)</Chip>
            <Chip className="border-melo/40 text-melo-dark">❤️ {likes} me gusta</Chip>
            <Chip>✂️ {totalCompletadas} servicios</Chip>
          </div>
        </div>
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs text-ink-soft">
            <span>{lvl.current.name}</span>
            <span>{lvl.next ? `${totalCompletadas}/${lvl.next.min} servicios para ${lvl.next.name} ${lvl.next.icon}` : "¡Nivel máximo alcanzado! 👑"}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-ink/10">
            <div className="h-full rounded-full bg-gradient-to-r from-brass to-melo transition-all" style={{ width: `${lvl.progress}%` }} />
          </div>
        </div>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-brass/40 bg-brass/5 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Citas de hoy</div>
          <div className="mt-1 font-display text-3xl font-bold">{myAppointments.length}</div>
        </div>
        <div className="rounded-xl border border-ink/10 bg-ivory p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Ventas del mes</div>
          <div className="mt-1 font-display text-2xl font-bold">{cop(ventasMes)}</div>
          <div className="text-xs text-ink-soft">{completadasMes.length} servicios completados</div>
        </div>
        <div className="rounded-xl border border-ink/10 bg-ivory p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Comisiones por cobrar</div>
          <div className="mt-1 font-display text-2xl font-bold text-warn">{cop(pendientes)}</div>
          <div className="text-xs text-ink-soft">Pagadas: {cop(pagadas)}</div>
        </div>
        <div className="rounded-xl border border-ink/10 bg-ivory p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Próximas hoy</div>
          <div className="mt-1 font-display text-3xl font-bold">
            {myAppointments.filter((a) => a.status === "RESERVED" || a.status === "CONFIRMED").length}
          </div>
          <div className="text-xs text-ink-soft">{fmtDateMedium(new Date())}</div>
        </div>
      </div>

      <Card className="border-ink/10 bg-ivory">
        <CardHeader className="pb-2">
          <CardTitle className="font-display text-lg">Mi agenda de hoy</CardTitle>
        </CardHeader>
        <CardContent>
          {myAppointments.length === 0 ? (
            <div className="rounded-xl border border-dashed border-ink/15 px-4 py-10 text-center text-ink-soft">Hoy no tienes citas. ¡Buen momento para compartir tus trabajos!</div>
          ) : (
            <div className="grid gap-2">
              {myAppointments.map((a) => {
                const service = db.services.find((s) => s.id === a.serviceId);
                return (
                  <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-ink/10 bg-cream px-4 py-3 text-sm">
                    <span className="font-semibold tabular-nums">{timeHMInBogota(new Date(a.startTime))}</span>
                    <StatusBadge status={a.status} />
                    <span className="text-ink-soft">{service?.name} · {a.clientName}</span>
                    <Chip className="ml-auto">{a.code}</Chip>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
