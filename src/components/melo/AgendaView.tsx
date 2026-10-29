"use client";
// Agenda interna: calendario del día por barbero, detalle con acciones del flujo
// (confirmar → atención → completar), reprogramación, nueva cita manual y
// registro de pagos. Público y manual comparten validaciones (requisito F).
import { useMemo, useState } from "react";
import { api, useData } from "@/lib/api";
import { cn } from "@/lib/utils";
import { cop } from "@/lib/money";
import {
  DIAS, MESES, dateKeyInBogota, timeHMInBogota, partsInBogota, fmtDateLong, addDaysKey, pad2,
} from "@/lib/time";
import type { SessionUser } from "@/components/melo/LoginView";
import {
  StatusBadge, Chip, SectionTitle, EmptyState, LoadingBlock, ErrorBlock, Money, METHOD_LABEL,
} from "@/components/melo/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast, useToast } from "@/hooks/use-toast";
import {
  CalendarDays, ChevronLeft, ChevronRight, Plus, Phone, User, Scissors, Wallet, Clock, CircleCheck, Ban, UserX, CalendarClock, RefreshCw, BadgePercent, ChevronDown,
} from "lucide-react";

export type ApptRow = {
  id: string;
  code: string;
  status: string;
  origin: "PUBLIC" | "MANUAL";
  startTime: string;
  endTime: string;
  clientName: string;
  clientPhone: string | null;
  clientEmail: string | null;
  notes: string | null;
  cancelReason: string | null;
  completedAt: string | null;
  barber: { id: string; name: string };
  service: { id: string; name: string; durationMin: number };
  creator: { id: string | null; name: string };
  priceSnapshot: number;
  discount: number;
  financial: { pagado: number; pendiente: number; commission: { status: string; amount: number; configured: boolean } | null } | null;
};

type Catalog = {
  services: Array<{ id: string; name: string; description: string | null; price: number; durationMin: number }>;
  barbers: Array<{ id: string; name: string }>;
};

export function AgendaView({ user }: { user: SessionUser }) {
  const [date, setDate] = useState(dateKeyInBogota(new Date()));
  const apptQ = useData<{ appointments: ApptRow[] }>(`/api/appointments?date=${date}`, [date]);
  const catalogQ = useData<Catalog>("/api/public/catalog");
  const [barberFilter, setBarberFilter] = useState<string>("ALL");
  const [selected, setSelected] = useState<ApptRow | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const isOwner = user.role === "OWNER";

  const barbers = catalogQ.data?.barbers ?? [];
  const byBarber = useMemo(() => {
    const map = new Map<string, ApptRow[]>();
    for (const b of barbers) map.set(b.id, []);
    for (const a of apptQ.data?.appointments ?? []) {
      if (!map.has(a.barber.id)) map.set(a.barber.id, []);
      map.get(a.barber.id)!.push(a);
    }
    for (const list of map.values()) list.sort((x, y) => x.startTime.localeCompare(y.startTime));
    return map;
  }, [apptQ.data, barbers]);

  const shownBarbers = barberFilter === "ALL" ? barbers : barbers.filter((b) => b.id === barberFilter);
  const dow = new Date(`${date}T12:00:00-05:00`).getUTCDay();
  const p = partsInBogota(new Date(`${date}T12:00:00-05:00`));

  return (
    <div>
      <SectionTitle
        title="Agenda"
        sub="Calendario compartido: reservas web y citas manuales en la misma base con las mismas validaciones."
        right={
          <Button onClick={() => setNewOpen(true)} className="bg-melo text-ivory hover:bg-melo-dark">
            <Plus className="mr-1 h-4 w-4" /> Nueva cita manual
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-xl border border-ink/15 bg-ivory p-1">
          <Button variant="ghost" size="icon" onClick={() => setDate(addDaysKey(date, -1))} aria-label="Día anterior"><ChevronLeft className="h-4 w-4" /></Button>
          <div className="px-2 text-center">
            <div className="font-display text-lg font-bold capitalize">{DIAS[dow]} {p.day} de {MESES[p.month - 1]}</div>
            <div className="text-[11px] text-ink-soft">{date}</div>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setDate(addDaysKey(date, 1))} aria-label="Día siguiente"><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <Input
          type="date"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          className="w-40"
        />
        <Button variant="outline" onClick={() => setDate(dateKeyInBogota(new Date()))} className="border-ink/15">Hoy</Button>
        <Select value={barberFilter} onValueChange={setBarberFilter}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Todos los barberos</SelectItem>
            {barbers.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {apptQ.loading ? <LoadingBlock label="Cargando agenda…" /> : null}
      {apptQ.error ? <ErrorBlock message={apptQ.error} onRetry={apptQ.reload} /> : null}

      {apptQ.data ? (
        shownBarbers.length === 0 ? (
          <EmptyState title="Sin barberos activos" sub="Crea barberos desde Equipo (panel del propietario)." />
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            {shownBarbers.map((b) => {
              const list = byBarber.get(b.id) ?? [];
              const isSelf = b.id === user.id;
              return (
                <div key={b.id} className={cn("rounded-2xl border bg-ivory p-4", isSelf ? "border-brass/60 shadow-sm" : "border-ink/10")}>
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brass/15 font-display text-sm font-bold text-brass-dark">
                        {b.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                      </span>
                      <div>
                        <div className="text-sm font-semibold">{b.name}{isSelf ? " (tú)" : ""}</div>
                        <div className="text-[11px] text-ink-soft">{list.length} cita(s)</div>
                      </div>
                    </div>
                    <Chip><Clock className="h-3 w-3" /> {list.filter((a) => a.status === "COMPLETED").length} hechas</Chip>
                  </div>
                  {list.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-ink/15 px-3 py-6 text-center text-sm text-ink-soft">Libre todo el día</div>
                  ) : (
                    <div className="flex max-h-105 flex-col gap-2 overflow-y-auto pr-1 nice-scroll">
                      {list.map((a) => (
                        <button
                          key={a.id}
                          onClick={() => setSelected(a)}
                          className={cn(
                            "w-full rounded-xl border p-3 text-left transition hover:shadow-md",
                            a.status === "COMPLETED" ? "border-good/40 bg-good/5"
                              : a.status === "CANCELLED" || a.status === "NO_SHOW" ? "border-ink/10 bg-cream/60 opacity-75"
                              : "border-ink/15 bg-cream"
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold tabular-nums">{timeHMInBogota(new Date(a.startTime))}–{timeHMInBogota(new Date(a.endTime))}</span>
                            <StatusBadge status={a.status} />
                          </div>
                          <div className="mt-1 truncate text-sm text-ink-soft">
                            {a.clientName} · {a.service.name}
                          </div>
                          <div className="mt-1 flex items-center gap-2">
                            <Chip>{a.origin === "PUBLIC" ? "Web" : "Manual"}</Chip>
                            {a.financial ? (
                              a.financial.pendiente > 0 ? (
                                <Chip className="border-warn/40 text-warn">Falta {cop(a.financial.pendiente)}</Chip>
                              ) : (
                                <Chip className="border-good/40 text-good">Pagado</Chip>
                              )
                            ) : null}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : null}

      {selected ? (
        <AppointmentDetail
          apptId={selected.id}
          user={user}
          onClose={() => setSelected(null)}
          onChanged={() => { apptQ.reload(); }}
          catalog={catalogQ.data}
        />
      ) : null}

      <NewAppointmentDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        user={user}
        catalog={catalogQ.data}
        onCreated={() => { apptQ.reload(); setNewOpen(false); toast({ title: "Cita creada", description: "La cita quedó registrada en la agenda." }); }}
      />
    </div>
  );
}

// ============================== DETALLE ==============================

export function AppointmentDetail({
  apptId, user, onClose, onChanged, catalog,
}: {
  apptId: string;
  user: SessionUser;
  onClose: () => void;
  onChanged: () => void;
  catalog: Catalog | null;
}) {
  const detailQ = useData<{ appointments: ApptRow[] }>(`/api/appointments?from=2000-01-01&to=2999-01-01`, []);
  const appt = detailQ.data?.appointments.find((a) => a.id === apptId) ?? null;

  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"view" | "reschedule">("view");
  const [discount, setDiscount] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const { toast } = useToast();

  async function act(body: Record<string, unknown>, okMsg: string) {
    setBusy(true);
    try {
      await api(`/api/appointments/${apptId}`, { method: "PATCH", body: JSON.stringify(body) });
      toast({ title: okMsg });
      await detailQ.reload();
      onChanged();
    } catch (err) {
      toast({ title: "Acción rechazada", description: err instanceof Error ? err.message : "Error", variant: "destructive" });
      throw err;
    } finally {
      setBusy(false);
    }
  }

  if (detailQ.loading)
    return (
      <Sheet open>
        <SheetContent>
          <SheetHeader className="sr-only">
            <SheetTitle>Cargando cita</SheetTitle>
          </SheetHeader>
          <LoadingBlock />
        </SheetContent>
      </Sheet>
    );
  if (!appt)
    return (
      <Sheet open>
        <SheetContent>
          <SheetHeader className="sr-only">
            <SheetTitle>Cita no encontrada</SheetTitle>
          </SheetHeader>
          <ErrorBlock message="Cita no encontrada" onRetry={detailQ.reload} />
        </SheetContent>
      </Sheet>
    );

  const canManage = user.role === "OWNER" || appt.barber.id === user.id;
  const canSeeFinancial = !!appt.financial;
  const net = appt.priceSnapshot - appt.discount;

  return (
    <Sheet open onOpenChange={(o) => (o ? undefined : onClose())}>
      <SheetContent className="w-full overflow-y-auto nice-scroll sm:max-w-lg">
        <SheetHeader className="pb-0">
          <SheetTitle className="flex flex-wrap items-center gap-2">
            <span className="font-display text-xl">{appt.code}</span>
            <StatusBadge status={appt.status} />
            <Chip className="ml-auto">{appt.origin === "PUBLIC" ? "Reserva web" : "Cita manual"}</Chip>
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 grid gap-4">
          <div className="rounded-xl border border-ink/10 bg-cream p-4">
            <div className="font-display text-lg font-bold">{appt.service.name}</div>
            <div className="mt-1 text-sm text-ink-soft">
              {fmtDateLong(new Date(appt.startTime))} · {timeHMInBogota(new Date(appt.startTime))}–{timeHMInBogota(new Date(appt.endTime))} ({appt.service.durationMin} min)
            </div>
            <div className="mt-2 flex items-center gap-2 text-sm">
              <User className="h-4 w-4 text-brass" /> {appt.clientName}
              {appt.clientPhone ? <><span className="text-ink/30">|</span><Phone className="h-4 w-4 text-brass" /> {appt.clientPhone}</> : null}
            </div>
            <div className="mt-1 text-sm text-ink-soft">Barbero: {appt.barber.name} · Creada por: {appt.creator.name}</div>
            {appt.notes ? <div className="mt-2 rounded-lg bg-ivory p-2 text-sm">Nota: {appt.notes}</div> : null}
            {appt.cancelReason ? <div className="mt-2 rounded-lg bg-melo/10 p-2 text-sm text-melo-dark">Motivo de cancelación: {appt.cancelReason}</div> : null}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-ink/10 bg-ivory p-3">
              <div className="text-[11px] uppercase tracking-wide text-ink-soft">Precio de la cita (copia)</div>
              <div className="font-display text-xl font-bold"><Money value={appt.priceSnapshot} /></div>
            </div>
            <div className="rounded-xl border border-ink/10 bg-ivory p-3">
              <div className="text-[11px] uppercase tracking-wide text-ink-soft">Descuento al completar</div>
              <div className="font-display text-xl font-bold">{appt.discount > 0 ? `− ${cop(appt.discount)}` : "—"}</div>
            </div>
          </div>

          {canSeeFinancial ? (
            <div className="rounded-xl border border-brass/40 bg-brass/5 p-4">
              <div className="mb-2 flex items-center gap-2 font-semibold"><Wallet className="h-4 w-4 text-brass-dark" /> Estado financiero</div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div><div className="text-[11px] text-ink-soft">Neto</div><div className="font-bold">{cop(net)}</div></div>
                <div><div className="text-[11px] text-ink-soft">Pagado</div><div className="font-bold text-good">{cop(appt.financial!.pagado)}</div></div>
                <div><div className="text-[11px] text-ink-soft">Pendiente</div><div className="font-bold text-warn">{cop(appt.financial!.pendiente)}</div></div>
              </div>
              {appt.financial!.commission ? (
                <div className="mt-3 border-t border-brass/30 pt-2 text-sm">
                  Comisión {appt.financial!.commission.configured ? "" : "(sin regla al completar) "}:{" "}
                  <b>{cop(appt.financial!.commission.amount)}</b>{" · "}
                  <span className="text-ink-soft">{appt.financial!.commission.status === "PAID" ? "pagada" : appt.financial!.commission.status === "PENDING_CONFIG" ? "por definir" : "pendiente de liquidar"}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* acciones */}
          {canManage ? (
            <div className="grid gap-2">
              {appt.status === "RESERVED" ? (
                <>
                  <Button disabled={busy} onClick={() => act({ action: "status", to: "CONFIRMED" }, "Cita confirmada")} className="bg-pole hover:bg-pole/80 text-ivory">
                    <CircleCheck className="mr-2 h-4 w-4" /> Confirmar cita
                  </Button>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" disabled={busy} onClick={() => setMode("reschedule")} className="border-ink/20">
                      <CalendarClock className="mr-2 h-4 w-4" /> Reprogramar
                    </Button>
                    <CancelDialog disabled={busy} onConfirm={(reason) => act({ action: "status", to: "CANCELLED", reason }, "Cita cancelada")} />
                  </div>
                  <Button variant="outline" disabled={busy} onClick={() => act({ action: "status", to: "NO_SHOW" }, "Marcada como ausencia")} className="border-ink/20 text-ink-soft">
                    <UserX className="mr-2 h-4 w-4" /> Marcar ausencia del cliente
                  </Button>
                </>
              ) : null}

              {appt.status === "CONFIRMED" ? (
                <>
                  <Button disabled={busy} onClick={() => act({ action: "status", to: "IN_ATTENTION" }, "Cita en atención")} className="bg-warn hover:bg-warn/80 text-ivory">
                    <Scissors className="mr-2 h-4 w-4" /> Iniciar atención
                  </Button>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" disabled={busy} onClick={() => setMode("reschedule")} className="border-ink/20">
                      <CalendarClock className="mr-2 h-4 w-4" /> Reprogramar
                    </Button>
                    <CancelDialog disabled={busy} onConfirm={(reason) => act({ action: "status", to: "CANCELLED", reason }, "Cita cancelada")} />
                  </div>
                  <Button variant="outline" disabled={busy} onClick={() => act({ action: "status", to: "NO_SHOW" }, "Marcada como ausencia")} className="border-ink/20 text-ink-soft">
                    <UserX className="mr-2 h-4 w-4" /> Marcar ausencia del cliente
                  </Button>
                </>
              ) : null}

              {appt.status === "IN_ATTENTION" ? (
                <div className="rounded-xl border border-good/40 bg-good/5 p-4">
                  <div className="mb-2 flex items-center gap-2 font-semibold"><BadgePercent className="h-4 w-4 text-good" /> Completar servicio</div>
                  <Label className="text-xs text-ink-soft">Descuento aplicado en esta venta (opcional)</Label>
                  <div className="mt-1 flex gap-2">
                    <Input
                      type="number" min={0} max={appt.priceSnapshot} placeholder="0"
                      value={discount} onChange={(e) => setDiscount(e.target.value)} className="w-36"
                    />
                    <span className="self-center text-sm text-ink-soft">de {cop(appt.priceSnapshot)}</span>
                  </div>
                  <Button
                    disabled={busy}
                    className="mt-3 w-full bg-good hover:bg-good/85 text-ivory"
                    onClick={() =>
                      act({ action: "complete", discount: Number(discount || 0) }, "Servicio completado. Ya puedes registrar el pago.")
                        .then(() => setPayOpen(true))
                        .catch(() => undefined)
                    }
                  >
                    <CircleCheck className="mr-2 h-4 w-4" /> Completar y generar comisión
                  </Button>
                  <p className="mt-2 text-xs text-ink-soft">
                    Al completar se guarda una copia inmutable de las condiciones económicas vigentes (regla de comisión, precio y descuento). Cambios futuros de tarifas no alteran este registro.
                  </p>
                </div>
              ) : null}

              {appt.status === "COMPLETED" && canSeeFinancial && appt.financial!.pendiente > 0 ? (
                <Button onClick={() => setPayOpen(true)} className="bg-melo hover:bg-melo-dark text-ivory">
                  <Wallet className="mr-2 h-4 w-4" /> Registrar pago
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="rounded-xl border border-ink/10 bg-cream p-3 text-sm text-ink-soft">
              Solo el barbero asignado o el propietario pueden gestionar esta cita.
            </div>
          )}

          {mode === "reschedule" && canManage && catalog ? (
            <RescheduleForm
              appt={appt}
              catalog={catalog}
              busy={busy}
              onCancel={() => setMode("view")}
              onSubmit={async (payload) => {
                await act({ action: "reschedule", ...payload }, "Cita reprogramada");
                setMode("view");
              }}
            />
          ) : null}
        </div>

        {payOpen && appt.status === "COMPLETED" ? (
          <PaymentDialog
            appt={appt}
            onClose={() => setPayOpen(false)}
            onPaid={() => { setPayOpen(false); detailQ.reload(); onChanged(); }}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function CancelDialog({ disabled, onConfirm }: { disabled: boolean; onConfirm: (reason: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled} className="border-melo/40 text-melo-dark hover:bg-melo/10">
          <Ban className="mr-2 h-4 w-4" /> Cancelar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Cancelar esta cita?</DialogTitle>
        </DialogHeader>
        <div className="grid gap-2">
          <Label>Motivo (queda en auditoría)</Label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej: el cliente lo pidió" />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Volver</Button>
          <Button
            disabled={busy || reason.trim().length < 3}
            className="bg-melo hover:bg-melo-dark text-ivory"
            onClick={async () => { setBusy(true); try { await onConfirm(reason); setOpen(false); setReason(""); } finally { setBusy(false); } }}
          >
            Cancelar cita
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RescheduleForm({
  appt, catalog, busy, onCancel, onSubmit,
}: {
  appt: ApptRow;
  catalog: Catalog;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (payload: { date: string; time: string; barberId: string }) => Promise<void>;
}) {
  const [date, setDate] = useState(dateKeyInBogota(new Date(appt.startTime)));
  const [time, setTime] = useState(timeHMInBogota(new Date(appt.startTime)));
  const [barberId, setBarberId] = useState(appt.barber.id);
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="rounded-xl border border-pole/40 bg-pole/5 p-4">
      <div className="mb-3 flex items-center gap-2 font-semibold"><RefreshCw className="h-4 w-4 text-pole" /> Reprogramar</div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1">
          <Label className="text-xs">Fecha</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Hora (HH:MM)</Label>
          <Input value={time} onChange={(e) => setTime(e.target.value)} placeholder="10:30" />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Barbero</Label>
          <Select value={barberId} onValueChange={setBarberId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {catalog.barbers.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      {err ? <div className="mt-2 rounded bg-melo/10 p-2 text-xs text-melo-dark">{err}</div> : null}
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={busy}>Cerrar</Button>
        <Button
          disabled={busy}
          className="bg-pole hover:bg-pole/80 text-ivory"
          onClick={async () => {
            setErr(null);
            try { await onSubmit({ date, time, barberId }); } catch (e) { setErr(e instanceof Error ? e.message : "Error"); }
          }}
        >
          Guardar nueva hora
        </Button>
      </div>
    </div>
  );
}

// ============================== PAGO ==============================

export function PaymentDialog({ appt, onClose, onPaid }: { appt: ApptRow; onClose: () => void; onPaid: () => void }) {
  const net = appt.priceSnapshot - appt.discount;
  const pagado = appt.financial?.pagado ?? 0;
  const pendiente = Math.max(0, net - pagado);
  const [amount, setAmount] = useState(String(pendiente || ""));
  const [method, setMethod] = useState("CASH");
  const [externalRef, setExternalRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // idempotencia: un identificador por apertura del diálogo
  const [reqId] = useState(() => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `pay-${Date.now()}-${Math.random()}`));

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await api("/api/payments", {
        method: "POST",
        body: JSON.stringify({
          appointmentId: appt.id,
          amount: Number(amount),
          method,
          externalRef: externalRef || null,
          clientRequestId: reqId,
        }),
      });
      onPaid();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al registrar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar pago · {appt.code}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-2 rounded-xl bg-cream p-3 text-center text-sm">
          <div><div className="text-[11px] text-ink-soft">Neto</div><b>{cop(net)}</b></div>
          <div><div className="text-[11px] text-ink-soft">Ya pagado</div><b className="text-good">{cop(pagado)}</b></div>
          <div><div className="text-[11px] text-ink-soft">Pendiente</div><b className="text-warn">{cop(pendiente)}</b></div>
        </div>
        <div className="mt-4 grid gap-3">
          <div className="grid gap-1">
            <Label>Monto recibido</Label>
            <Input type="number" min={1} max={pendiente} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label>Método</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(METHOD_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {method !== "CASH" ? (
            <div className="grid gap-1">
              <Label>Referencia externa (opcional)</Label>
              <Input value={externalRef} onChange={(e) => setExternalRef(e.target.value)} placeholder="N.º de operación" />
            </div>
          ) : null}
          {err ? <div className="rounded-lg bg-melo/10 p-2 text-sm text-melo-dark">{err}</div> : null}
          <p className="text-xs text-ink-soft">
            El pago se registra una sola vez: la solicitud lleva un identificador único y el servidor impide pasar el valor neto de la cita.
          </p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
          <Button disabled={busy || !amount || Number(amount) <= 0} onClick={submit} className="bg-good hover:bg-good/85 text-ivory">
            {busy ? "Registrando…" : "Registrar pago"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================== NUEVA CITA MANUAL ==============================

export function NewAppointmentDialog({
  open, onOpenChange, user, catalog, onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  user: SessionUser;
  catalog: Catalog | null;
  onCreated: () => void;
}) {
  const isOwner = user.role === "OWNER";
  const [serviceId, setServiceId] = useState("");
  const [barberId, setBarberId] = useState(isOwner ? "" : user.id);
  const [date, setDate] = useState(dateKeyInBogota(new Date()));
  const [time, setTime] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [allowPast, setAllowPast] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const service = catalog?.services.find((s) => s.id === serviceId) ?? null;
  const effectiveBarberId = isOwner ? barberId : user.id;
  const slotsQ = useData<{ slots: Array<{ time: string }> }>(
    open && serviceId && effectiveBarberId && date ? `/api/public/slots?serviceId=${serviceId}&date=${date}&barberId=${effectiveBarberId}` : null,
    [open, serviceId, effectiveBarberId, date]
  );

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await api("/api/appointments", {
        method: "POST",
        body: JSON.stringify({
          barberId: effectiveBarberId,
          serviceId,
          date,
          time,
          clientName,
          clientPhone: clientPhone || null,
          notes: notes || null,
          allowPastToday: allowPast,
        }),
      });
      onCreated();
      setServiceId(""); setTime(""); setClientName(""); setClientPhone(""); setNotes("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al crear");
    } finally {
      setBusy(false);
    }
  }

  const valid = serviceId && (isOwner ? barberId : true) && date && /^\d{1,2}:\d{2}$/.test(time) && clientName.trim().length >= 2;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-90 overflow-y-auto nice-scroll sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Nueva cita manual</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-ink-soft">
          Registra citas presenciales, telefónicas u de otros canales. Se validan disponibilidad y solapamientos igual que las reservas web.
        </p>
        <div className="mt-2 grid gap-3">
          <div className="grid gap-1 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label>Servicio *</Label>
              <Select value={serviceId} onValueChange={(v) => { setServiceId(v); setTime(""); }}>
                <SelectTrigger><SelectValue placeholder="Elegir" /></SelectTrigger>
                <SelectContent>
                  {catalog?.services.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} · {cop(s.price)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label>Barbero *</Label>
              <Select value={effectiveBarberId || undefined} onValueChange={setBarberId} disabled={!isOwner}>
                <SelectTrigger><SelectValue placeholder="Elegir" /></SelectTrigger>
                <SelectContent>
                  {catalog?.barbers.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}{b.id === user.id ? " (tú)" : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-1 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label>Fecha *</Label>
              <Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setTime(""); }} />
            </div>
            <div className="grid gap-1">
              <Label>Hora * (HH:MM)</Label>
              <Input value={time} onChange={(e) => setTime(e.target.value)} placeholder="10:30" />
            </div>
          </div>

          {slotsQ.data && slotsQ.data.slots.length > 0 ? (
            <div>
              <div className="mb-1 flex items-center gap-1 text-xs text-ink-soft"><ChevronDown className="h-3 w-3" /> Horas libres sugeridas:</div>
              <div className="flex flex-wrap gap-1.5">
                {slotsQ.data.slots.slice(0, 12).map((s) => (
                  <button
                    key={s.time}
                    onClick={() => setTime(s.time)}
                    className={cn("rounded-lg border px-2 py-1 text-xs tabular-nums", time === s.time ? "border-melo bg-melo text-ivory" : "border-ink/15 bg-ivory hover:border-brass")}
                  >
                    {s.time}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid gap-1 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label>Cliente *</Label>
              <Input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Nombre de quien llega" />
            </div>
            <div className="grid gap-1">
              <Label>Teléfono (opcional)</Label>
              <Input value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} placeholder="+57 …" />
            </div>
          </div>

          <div className="grid gap-1">
            <Label>Notas (opcional)</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Preferencias del cliente…" />
          </div>

          <label className="flex items-center gap-2 text-sm text-ink-soft">
            <Checkbox checked={allowPast} onCheckedChange={(c) => setAllowPast(!!c)} />
            Permitir una hora ya transcurrida hoy (registro de atención en curso o reciente)
          </label>

          {err ? <div className="rounded-lg border border-melo/40 bg-melo/10 p-2 text-sm text-melo-dark">{err}</div> : null}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={busy || !valid} onClick={submit} className="bg-melo hover:bg-melo-dark text-ivory">
            {busy ? "Creando…" : "Crear cita"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
