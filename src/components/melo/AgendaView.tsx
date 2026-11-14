"use client";
// Agenda compartida: día por barbero, flujo completo del servicio, pagos,
// nueva cita manual y Excel de citas. Cliente puro (localStorage).
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { cop } from "@/lib/money";
import {
  DIAS, MESES, dateKeyInBogota, timeHMInBogota, partsInBogota, fmtDateLong, addDaysKey,
} from "@/lib/time";
import {
  getDB, mutateDB, type SessionUser, type Appointment,
} from "@/lib/store";
import {
  changeStatus, completeAppointment, rescheduleAppointment, registerPayment, appointmentFinancial,
  BizError, freeSlotsForBarber,
} from "@/lib/engines/booking";
import { StatusBadge, Chip, SectionTitle, EmptyState, Money, METHOD_LABEL } from "@/components/melo/ui";
import { exportAppointmentsExcel } from "@/lib/excel";
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
  CalendarDays, ChevronLeft, ChevronRight, Plus, Phone, User, Scissors, Wallet, Clock,
  CircleCheck, Ban, UserX, CalendarClock, RefreshCw, BadgePercent, FileDown,
} from "lucide-react";

export function AgendaView({ user }: { user: SessionUser }) {
  const [date, setDate] = useState(dateKeyInBogota(new Date()));
  const [tick, setTick] = useState(0);
  const [barberFilter, setBarberFilter] = useState<string>("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const isOwner = user.role === "OWNER";

  useEffect(() => {
    const h = () => setTick((n) => n + 1);
    window.addEventListener("melo:db-changed", h);
    return () => window.removeEventListener("melo:db-changed", h);
  }, []);

  const db = getDB();
  const barbers = isOwner ? db.barbers.filter((b) => b.active) : db.barbers.filter((b) => b.id === user.id);
  const dayStart = new Date(`${date}T00:00:00-05:00`).toISOString();
  const dayEnd = new Date(new Date(`${date}T00:00:00-05:00`).getTime() + 24 * 3600 * 1000).toISOString();
  const dayAppointments = useMemo(
    () => db.appointments.filter((a) => a.startTime >= dayStart && a.startTime < dayEnd),
    [tick, date, db.appointments.length]
  );

  const byBarber = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const b of barbers) map.set(b.id, []);
    for (const a of dayAppointments) {
      if (!map.has(a.barberId)) map.set(a.barberId, []);
      map.get(a.barberId)!.push(a);
    }
    for (const list of map.values()) list.sort((x, y) => x.startTime.localeCompare(y.startTime));
    return map;
  }, [dayAppointments, barbers]);

  const shownBarbers = barberFilter === "ALL" ? barbers : barbers.filter((b) => b.id === barberFilter);
  const dow = new Date(`${date}T12:00:00-05:00`).getUTCDay();
  const p = partsInBogota(new Date(`${date}T12:00:00-05:00`));

  function exportExcel() {
    const rows = dayAppointments.map((a) => {
      const fin = appointmentFinancial(db, a.id);
      const barber = db.barbers.find((b) => b.id === a.barberId);
      const service = db.services.find((s) => s.id === a.serviceId);
      return {
        fecha: date, hora: timeHMInBogota(new Date(a.startTime)), cita: a.code, cliente: a.clientName,
        telefono: a.clientPhone ?? "", barbero: barber?.name ?? "", servicio: service?.name ?? "",
        estado: a.status, origen: a.origin === "PUBLIC" ? "Web" : "Manual",
        precio: a.priceSnapshot, descuento: a.discount, neto: fin.net, pagado: fin.pagado, pendiente: fin.pendiente,
      };
    });
    exportAppointmentsExcel(rows, date, date);
    toast({ title: "Excel generado", description: `Citas del ${date}.` });
  }

  return (
    <div>
      <SectionTitle
        title={isOwner ? "Agenda" : "Mi agenda"}
        sub="Calendario compartido: reservas web y citas manuales con las mismas validaciones. Confirma el flujo del servicio y registra el pago aquí."
        right={
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportExcel} className="border-brass/50 text-brass-dark hover:bg-brass/10">
              <FileDown className="mr-1 h-4 w-4" /> Excel del día
            </Button>
            <Button onClick={() => setNewOpen(true)} className="bg-melo text-ivory hover:bg-melo-dark">
              <Plus className="mr-1 h-4 w-4" /> Nueva cita manual
            </Button>
          </div>
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
        <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-40" />
        <Button variant="outline" onClick={() => setDate(dateKeyInBogota(new Date()))} className="border-ink/15">Hoy</Button>
        {isOwner ? (
          <Select value={barberFilter} onValueChange={setBarberFilter}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos los barberos</SelectItem>
              {barbers.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      {shownBarbers.length === 0 ? (
        <EmptyState title="Sin barberos activos" sub={isOwner ? "Crea barberos desde Equipo." : "Consulta con el propietario."} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {shownBarbers.map((b) => {
            const list = byBarber.get(b.id) ?? [];
            const isSelf = b.id === user.id;
            return (
              <div key={b.id} className={cn("rounded-2xl border bg-ivory p-4", isSelf ? "border-brass/60 shadow-sm" : "border-ink/10")}>
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {b.photo ? (
                      <img src={b.photo} alt={b.name} className="h-9 w-9 rounded-full object-cover ring-2 ring-brass/40" />
                    ) : (
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brass/15 font-display text-sm font-bold text-brass-dark">
                        {b.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                      </span>
                    )}
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
                  <div className="flex max-h-[40dvh] flex-col gap-2 overflow-y-auto pr-1 nice-scroll">
                    {list.map((a) => {
                      const fin = appointmentFinancial(db, a.id);
                      const service = db.services.find((s) => s.id === a.serviceId);
                      return (
                        <button
                          key={a.id}
                          onClick={() => setSelectedId(a.id)}
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
                            {a.clientName} · {service?.name}
                          </div>
                          <div className="mt-1 flex items-center gap-2">
                            <Chip>{a.origin === "PUBLIC" ? "Web" : "Manual"}</Chip>
                            {a.status === "COMPLETED" ? (
                              fin.pendiente > 0 ? (
                                <Chip className="border-warn/40 text-warn">Falta {cop(fin.pendiente)}</Chip>
                              ) : (
                                <Chip className="border-good/40 text-good">Pagado</Chip>
                              )
                            ) : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {selectedId ? (
        <AppointmentDetail
          apptId={selectedId}
          user={user}
          onClose={() => setSelectedId(null)}
        />
      ) : null}

      {newOpen ? (
        <NewAppointmentDialog
          open={newOpen}
          onOpenChange={setNewOpen}
          user={user}
          onCreated={() => { setNewOpen(false); setTick((n) => n + 1); toast({ title: "Cita creada", description: "La cita quedó registrada en la agenda." }); }}
        />
      ) : null}
    </div>
  );
}

// ============================== DETALLE ==============================

export function AppointmentDetail({
  apptId, user, onClose,
}: {
  apptId: string;
  user: SessionUser;
  onClose: () => void;
}) {
  const [, force] = useState(0);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"view" | "reschedule">("view");
  const [discount, setDiscount] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const { toast } = useToast();

  const db = getDB();
  const appt = db.appointments.find((a) => a.id === apptId) ?? null;

  async function act(fn: () => void, okMsg: string) {
    setBusy(true);
    try {
      fn();
      toast({ title: okMsg });
      force((n) => n + 1);
    } catch (err) {
      toast({ title: "Acción rechazada", description: err instanceof Error ? err.message : "Error", variant: "destructive" });
      throw err;
    } finally {
      setBusy(false);
    }
  }

  if (!appt) {
    return (
      <Sheet open onOpenChange={(o) => (o ? undefined : onClose())}>
        <SheetContent>
          <SheetHeader className="sr-only"><SheetTitle>Cita no encontrada</SheetTitle></SheetHeader>
          <div className="p-6 text-sm text-ink-soft">Cita no encontrada.</div>
        </SheetContent>
      </Sheet>
    );
  }

  const barber = db.barbers.find((b) => b.id === appt.barberId);
  const service = db.services.find((s) => s.id === appt.serviceId);
  const canManage = user.role === "OWNER" || appt.barberId === user.id;
  const fin = appt.status === "COMPLETED" ? appointmentFinancial(db, apptId) : null;
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
            <div className="font-display text-lg font-bold">{service?.name}</div>
            <div className="mt-1 text-sm text-ink-soft">
              {fmtDateLong(new Date(appt.startTime))} · {timeHMInBogota(new Date(appt.startTime))}–{timeHMInBogota(new Date(appt.endTime))} ({service?.durationMin} min)
            </div>
            <div className="mt-2 flex items-center gap-2 text-sm">
              <User className="h-4 w-4 text-brass" /> {appt.clientName}
              {appt.clientPhone ? <><span className="text-ink/30">|</span><Phone className="h-4 w-4 text-brass" /> {appt.clientPhone}</> : null}
            </div>
            <div className="mt-1 text-sm text-ink-soft">Barbero: {barber?.name}</div>
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

          {fin ? (
            <div className="rounded-xl border border-brass/40 bg-brass/5 p-4">
              <div className="mb-2 flex items-center gap-2 font-semibold"><Wallet className="h-4 w-4 text-brass-dark" /> Estado financiero</div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div><div className="text-[11px] text-ink-soft">Neto</div><div className="font-bold">{cop(net)}</div></div>
                <div><div className="text-[11px] text-ink-soft">Pagado</div><div className="font-bold text-good">{cop(fin.pagado)}</div></div>
                <div><div className="text-[11px] text-ink-soft">Pendiente</div><div className="font-bold text-warn">{cop(fin.pendiente)}</div></div>
              </div>
              {fin.commission ? (
                <div className="mt-3 border-t border-brass/30 pt-2 text-sm">
                  Comisión {fin.commission.configured ? "" : "(sin regla al completar) "}:{" "}
                  <b>{cop(fin.commission.amount)}</b>{" · "}
                  <span className="text-ink-soft">{fin.commission.status === "PAID" ? "pagada" : fin.commission.status === "PENDING_CONFIG" ? "por definir" : "pendiente de liquidar"}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {canManage ? (
            <div className="grid gap-2">
              {appt.status === "RESERVED" ? (
                <>
                  <Button disabled={busy} onClick={() => act(() => changeStatus(apptId, "CONFIRMED", user.name), "Cita confirmada")} className="bg-pole hover:bg-pole/80 text-ivory">
                    <CircleCheck className="mr-2 h-4 w-4" /> Confirmar cita
                  </Button>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" disabled={busy} onClick={() => setMode("reschedule")} className="border-ink/20">
                      <CalendarClock className="mr-2 h-4 w-4" /> Reprogramar
                    </Button>
                    <CancelDialog disabled={busy} onConfirm={(reason) => act(() => changeStatus(apptId, "CANCELLED", user.name, reason), "Cita cancelada")} />
                  </div>
                  <Button variant="outline" disabled={busy} onClick={() => act(() => changeStatus(apptId, "NO_SHOW", user.name), "Marcada como ausencia")} className="border-ink/20 text-ink-soft">
                    <UserX className="mr-2 h-4 w-4" /> Marcar ausencia del cliente
                  </Button>
                </>
              ) : null}

              {appt.status === "CONFIRMED" ? (
                <>
                  <Button disabled={busy} onClick={() => act(() => changeStatus(apptId, "IN_ATTENTION", user.name), "Cita en atención")} className="bg-warn hover:bg-warn/80 text-ivory">
                    <Scissors className="mr-2 h-4 w-4" /> Iniciar atención
                  </Button>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" disabled={busy} onClick={() => setMode("reschedule")} className="border-ink/20">
                      <CalendarClock className="mr-2 h-4 w-4" /> Reprogramar
                    </Button>
                    <CancelDialog disabled={busy} onConfirm={(reason) => act(() => changeStatus(apptId, "CANCELLED", user.name, reason), "Cita cancelada")} />
                  </div>
                  <Button variant="outline" disabled={busy} onClick={() => act(() => changeStatus(apptId, "NO_SHOW", user.name), "Marcada como ausencia")} className="border-ink/20 text-ink-soft">
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
                      act(() => completeAppointment(apptId, Number(discount || 0), user.name), "Servicio completado. Ya puedes registrar el pago.")
                        .then(() => setPayOpen(true))
                        .catch(() => undefined)
                    }
                  >
                    <CircleCheck className="mr-2 h-4 w-4" /> Completar y generar comisión
                  </Button>
                  <p className="mt-2 text-xs text-ink-soft">
                    Al completar se guarda una copia inmutable de las condiciones económicas vigentes. Cambios futuros de tarifas no alteran este registro.
                  </p>
                </div>
              ) : null}

              {appt.status === "COMPLETED" && fin && fin.pendiente > 0 ? (
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

          {mode === "reschedule" && canManage ? (
            <RescheduleForm
              appt={appt}
              busy={busy}
              onCancel={() => setMode("view")}
              onSubmit={async (payload) => {
                await act(() => rescheduleAppointment(apptId, payload.date, payload.time, payload.barberId, user.name), "Cita reprogramada");
                setMode("view");
              }}
            />
          ) : null}
        </div>

        {payOpen && appt.status === "COMPLETED" ? (
          <PaymentDialog
            apptId={apptId}
            onClose={() => setPayOpen(false)}
            onPaid={() => { setPayOpen(false); force((n) => n + 1); }}
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
        <DialogHeader><DialogTitle>¿Cancelar esta cita?</DialogTitle></DialogHeader>
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
  appt, busy, onCancel, onSubmit,
}: {
  appt: Appointment;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (payload: { date: string; time: string; barberId: string }) => Promise<void>;
}) {
  const db = getDB();
  const [date, setDate] = useState(dateKeyInBogota(new Date(appt.startTime)));
  const [time, setTime] = useState(timeHMInBogota(new Date(appt.startTime)));
  const [barberId, setBarberId] = useState(appt.barberId);
  const [err, setErr] = useState<string | null>(null);

  const slots = useMemo(() => freeSlotsForBarber(getDB(), barberId, appt.serviceId, date), [barberId, date]);

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
              {db.barbers.filter((b) => b.active).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      {slots.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {slots.slice(0, 12).map((s) => (
            <button key={s} onClick={() => setTime(s)} className={cn("rounded-lg border px-2 py-1 text-xs tabular-nums", time === s ? "border-melo bg-melo text-ivory" : "border-ink/15 bg-ivory")}>
              {s}
            </button>
          ))}
        </div>
      ) : null}
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

export function PaymentDialog({ apptId, onClose, onPaid }: { apptId: string; onClose: () => void; onPaid: () => void }) {
  const db = getDB();
  const appt = db.appointments.find((a) => a.id === apptId);
  if (!appt) return null;
  const fin = appointmentFinancial(db, apptId);
  const net = fin.net;
  const pagado = fin.pagado;
  const pendiente = Math.max(0, net - pagado);
  const [amount, setAmount] = useState(String(pendiente || ""));
  const [method, setMethod] = useState<"CASH" | "TRANSFER" | "CARD" | "OTHER">("CASH");
  const [externalRef, setExternalRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // idempotencia: identificador por apertura del diálogo
  const [reqId] = useState(() => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `pay-${Date.now()}-${Math.random()}`));

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      registerPayment({
        appointmentId: apptId,
        amount: Number(amount),
        method,
        externalRef: externalRef || null,
        registeredByName: appt ? (db.barbers.find((b) => b.id === appt.barberId)?.name ?? "Panel") : "Panel",
        registeredById: reqId,
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
        <DialogHeader><DialogTitle>Registrar pago · {appt.code}</DialogTitle></DialogHeader>
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
            <Select value={method} onValueChange={(v) => setMethod(v as "CASH" | "TRANSFER" | "CARD" | "OTHER")}>
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
            El pago se registra una sola vez y no puede superar el valor neto de la cita. Se suma automáticamente a la caja del propietario.
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
  open, onOpenChange, user, onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  user: SessionUser;
  onCreated: () => void;
}) {
  const isOwner = user.role === "OWNER";
  const db = getDB();
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

  const effectiveBarberId = isOwner ? barberId : user.id;
  const slots = useMemo(
    () => (open && serviceId && effectiveBarberId ? freeSlotsForBarber(getDB(), effectiveBarberId, serviceId, date) : []),
    [open, serviceId, effectiveBarberId, date]
  );

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const { createAppointment } = await import("@/lib/engines/booking");
      const startMin = (Number(time.split(":")[0]) || 0) * 60 + (Number(time.split(":")[1]) || 0);
      createAppointment({
        barberId: effectiveBarberId,
        serviceId,
        dateKey: date,
        startMin,
        clientName,
        clientPhone: clientPhone || null,
        origin: "MANUAL",
        createdByName: user.name,
        notes: notes || null,
        allowPastToday: allowPast,
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
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>Nueva cita manual</DialogTitle></DialogHeader>
        <p className="text-sm text-ink-soft">
          Registra citas presenciales o telefónicas. Se validan disponibilidad y solapamientos igual que las reservas web.
        </p>
        <div className="mt-2 grid gap-3">
          <div className="grid gap-1 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label>Servicio *</Label>
              <Select value={serviceId} onValueChange={(v) => { setServiceId(v); setTime(""); }}>
                <SelectTrigger><SelectValue placeholder="Elegir" /></SelectTrigger>
                <SelectContent>
                  {db.services.filter((s) => s.active).map((s) => <SelectItem key={s.id} value={s.id}>{s.name} · {cop(s.price)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label>Barbero *</Label>
              <Select value={effectiveBarberId || undefined} onValueChange={setBarberId} disabled={!isOwner}>
                <SelectTrigger><SelectValue placeholder="Elegir" /></SelectTrigger>
                <SelectContent>
                  {db.barbers.filter((b) => b.active).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}{b.id === user.id ? " (tú)" : ""}</SelectItem>)}
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

          {slots.length > 0 ? (
            <div>
              <div className="mb-1 text-xs text-ink-soft">Horas libres sugeridas:</div>
              <div className="flex flex-wrap gap-1.5">
                {slots.slice(0, 12).map((s) => (
                  <button
                    key={s}
                    onClick={() => setTime(s)}
                    className={cn("rounded-lg border px-2 py-1 text-xs tabular-nums", time === s ? "border-melo bg-melo text-ivory" : "border-ink/15 bg-ivory hover:border-brass")}
                  >
                    {s}
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
