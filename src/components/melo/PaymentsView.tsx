"use client";
// Pagos y caja con exportación a Excel del rango filtrado en pantalla.
import { useEffect, useMemo, useState } from "react";
import { cop } from "@/lib/money";
import { timeHMInBogota, fmtDateMedium, dateKeyInBogota } from "@/lib/time";
import { getDB, type SessionUser } from "@/lib/store";
import { appointmentFinancial } from "@/lib/engines/booking";
import { cashMovements } from "@/lib/engines/finance";
import { refundPayment, BizError } from "@/lib/engines/booking";
import { SectionTitle, EmptyState, Chip, METHOD_LABEL, PAY_STATUS_META } from "@/components/melo/ui";
import { exportPaymentsExcel, exportCashExcel } from "@/lib/excel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { Wallet, RotateCcw, ArrowDownRight, ArrowUpRight, Landmark, FileDown } from "lucide-react";
import { cn } from "@/lib/utils";

type PaymentRow = ReturnType<typeof buildPaymentRows>[number];

function inRange(iso: string, from: string, to: string) {
  const dayStart = (k: string) => new Date(`${k}T00:00:00-05:00`).getTime();
  const t = new Date(iso).getTime();
  return t >= dayStart(from) && t < dayStart(to) + 24 * 3600 * 1000;
}

function buildPaymentRows(db: ReturnType<typeof getDB>, from: string, to: string, barberId?: string) {
  return db.payments
    .filter((p) => inRange(p.receivedAt, from, to))
    .map((p) => {
      const appt = db.appointments.find((a) => a.id === p.appointmentId);
      const barber = appt ? db.barbers.find((b) => b.id === appt.barberId) : undefined;
      const service = appt ? db.services.find((s) => s.id === appt.serviceId) : undefined;
      return {
        id: p.id,
        appointmentId: p.appointmentId,
        amount: p.amount,
        method: p.method,
        status: p.status,
        refundedAmount: p.refundedAmount,
        externalRef: p.externalRef,
        receivedAt: p.receivedAt,
        code: appt?.code ?? "?",
        clientName: appt?.clientName ?? "?",
        barberName: barber?.name ?? "—",
        serviceName: service?.name ?? "—",
        registeredBy: p.registeredByName,
      };
    })
    .filter((r) => (barberId ? r.barberName === (getDB().barbers.find((b) => b.id === barberId)?.name ?? "") : true))
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

export function PaymentsView({ user }: { user: SessionUser }) {
  const [from, setFrom] = useState(dateKeyInBogota(new Date()));
  const [to, setTo] = useState(dateKeyInBogota(new Date()));
  const [tick, setTick] = useState(0);
  const [refundFor, setRefundFor] = useState<PaymentRow | null>(null);

  useEffect(() => {
    const h = () => setTick((n) => n + 1);
    window.addEventListener("melo:db-changed", h);
    return () => window.removeEventListener("melo:db-changed", h);
  }, []);

  const db = getDB();
  const payments = useMemo(() => buildPaymentRows(db, from, to), [tick, from, to]);
  const { movements, balance } = useMemo(
    () => cashMovements(db, new Date(`${from}T00:00:00-05:00`), new Date(new Date(`${to}T00:00:00-05:00`).getTime() + 24 * 3600 * 1000)),
    [tick, from, to]
  );

  const totals = useMemo(() => {
    const cobrado = payments.reduce((s, p) => s + (p.amount - p.refundedAmount), 0);
    const devuelto = payments.reduce((s, p) => s + p.refundedAmount, 0);
    return { n: payments.length, cobrado, devuelto };
  }, [payments]);

  function downloadExcel() {
    exportPaymentsExcel(
      payments.map((p) => ({
        fecha: fmtDateMedium(new Date(p.receivedAt)),
        hora: timeHMInBogota(new Date(p.receivedAt)),
        cita: p.code, cliente: p.clientName, barbero: p.barberName, servicio: p.serviceName,
        monto: p.amount, devuelto: p.refundedAmount, neto: p.amount - p.refundedAmount,
        metodo: METHOD_LABEL[p.method] ?? p.method,
        estado: PAY_STATUS_META[p.status]?.label ?? p.status,
        referencia: p.externalRef ?? "", registro: p.registeredBy,
      })),
      from, to
    );
    toast({ title: "Excel generado", description: `Pagos del ${from} al ${to}.` });
  }

  function downloadCashExcel() {
    exportCashExcel(
      movements.map((m) => ({
        fecha: fmtDateMedium(new Date(m.date)),
        hora: timeHMInBogota(new Date(m.date)),
        tipo: m.kind, concepto: m.concept, detalle: m.detail,
        valor: m.kind === "INGRESO" ? m.amount : -m.amount,
        metodo: m.method ? (METHOD_LABEL[m.method] ?? m.method) : "",
      })),
      from, to, balance
    );
    toast({ title: "Excel generado", description: `Movimientos de caja del ${from} al ${to}.` });
  }

  return (
    <div>
      <SectionTitle title="Pagos y caja" sub="El pago se registra aparte de la cita completada. La caja consolida ingresos por pagos y egresos por gastos, anticipos y liquidaciones. Descarga en Excel lo que ves en pantalla." />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <Label className="text-xs">Desde</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Hasta</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
        <div className="ml-auto flex flex-wrap gap-2 rounded-xl bg-ivory px-4 py-2 text-sm">
          <span className="text-ink-soft">Cobrado neto:</span> <b>{cop(totals.cobrado)}</b>
          <span className="text-ink-soft ml-3">Devuelto:</span> <b>{cop(totals.devuelto)}</b>
        </div>
      </div>

      <Tabs defaultValue="payments">
        <TabsList className="bg-ivory">
          <TabsTrigger value="payments">Pagos registrados ({payments.length})</TabsTrigger>
          <TabsTrigger value="cash">Movimientos de caja</TabsTrigger>
        </TabsList>

        <TabsContent value="payments" className="mt-4">
          <div className="mb-3 flex justify-end">
            <Button variant="outline" onClick={downloadExcel} disabled={payments.length === 0} className="border-good/50 text-good hover:bg-good/10">
              <FileDown className="mr-1 h-4 w-4" /> Descargar Excel (rango en pantalla)
            </Button>
          </div>
          {payments.length === 0 ? (
            <EmptyState title="Sin pagos en el rango" sub="Los pagos se registran desde el detalle de una cita completada." />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-ink/10 bg-ivory">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Cita</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Barbero</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead>Método</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Ref.</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-sm whitespace-nowrap">{fmtDateMedium(new Date(p.receivedAt))} {timeHMInBogota(new Date(p.receivedAt))}</TableCell>
                      <TableCell className="font-medium">{p.code}</TableCell>
                      <TableCell>{p.clientName}</TableCell>
                      <TableCell className="text-sm text-ink-soft">{p.barberName}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{cop(p.amount)}{p.refundedAmount > 0 ? <span className="block text-xs text-melo-dark">− dev. {cop(p.refundedAmount)}</span> : null}</TableCell>
                      <TableCell><Chip>{METHOD_LABEL[p.method] ?? p.method}</Chip></TableCell>
                      <TableCell>
                        <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]", PAY_STATUS_META[p.status]?.cls ?? "")}>
                          {PAY_STATUS_META[p.status]?.label ?? p.status}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-28 truncate text-xs text-ink-soft">{p.externalRef ?? "—"}</TableCell>
                      <TableCell>
                        {user.role === "OWNER" ? (
                          <Button size="sm" variant="outline" className="h-7 border-melo/40 text-melo-dark" onClick={() => setRefundFor(p)} disabled={p.amount - p.refundedAmount <= 0}>
                            <RotateCcw className="mr-1 h-3 w-3" /> Devolver
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="cash" className="mt-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3 rounded-xl border border-ink/10 bg-ivory px-5 py-4">
              <Landmark className="h-6 w-6 text-brass-dark" />
              <div>
                <div className="text-xs uppercase tracking-wide text-ink-soft">Balance del período</div>
                <div className={cn("font-display text-2xl font-bold", balance >= 0 ? "text-good" : "text-melo-dark")}>
                  {cop(balance)}
                </div>
              </div>
            </div>
            <Button variant="outline" onClick={downloadCashExcel} disabled={movements.length === 0} className="border-good/50 text-good hover:bg-good/10">
              <FileDown className="mr-1 h-4 w-4" /> Descargar Excel de caja
            </Button>
          </div>
          {movements.length === 0 ? (
            <EmptyState title="Sin movimientos" sub="No hubo dinero entrante ni saliente en el rango." />
          ) : (
            <div className="overflow-hidden rounded-xl border border-ink/10 bg-ivory">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Concepto</TableHead>
                    <TableHead>Detalle</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.map((m, i) => (
                    <TableRow key={`${m.date}-${i}`}>
                      <TableCell className="text-sm whitespace-nowrap">{fmtDateMedium(new Date(m.date))} {timeHMInBogota(new Date(m.date))}</TableCell>
                      <TableCell>
                        <span className={cn("mr-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]", m.kind === "INGRESO" ? "bg-good/15 text-good" : "bg-melo/10 text-melo-dark")}>
                          {m.kind === "INGRESO" ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />} {m.kind}
                        </span>
                        {m.concept}
                      </TableCell>
                      <TableCell className="text-sm text-ink-soft">{m.detail}{m.method ? ` · ${METHOD_LABEL[m.method] ?? m.method}` : ""}</TableCell>
                      <TableCell className={cn("text-right font-semibold tabular-nums", m.kind === "INGRESO" ? "text-good" : "text-melo-dark")}>
                        {m.kind === "INGRESO" ? "+" : "−"} {cop(m.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {refundFor ? (
        <RefundDialog
          payment={refundFor}
          onClose={() => setRefundFor(null)}
          onDone={() => { setRefundFor(null); setTick((n) => n + 1); }}
        />
      ) : null}
    </div>
  );
}

function RefundDialog({ payment, onClose, onDone }: { payment: PaymentRow; onClose: () => void; onDone: () => void }) {
  const max = payment.amount - payment.refundedAmount;
  const [amount, setAmount] = useState(String(max));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      refundPayment(payment.id, Number(amount), reason, "Propietario");
      toast({ title: "Devolución registrada", description: "Quedó en auditoría. La comisión del barbero no se toca: usa Ajustes si aplica." });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Devolución · {payment.code}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="rounded-xl bg-cream p-3 text-sm">
            Pagado {cop(payment.amount)} · ya devuelto {cop(payment.refundedAmount)} · máximo devoluble <b>{cop(max)}</b>
          </div>
          <div className="grid gap-1">
            <Label>Monto a devolver</Label>
            <Input type="number" min={1} max={max} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label>Motivo (obligatorio)</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej: servicio insatisfecho" />
          </div>
          {err ? <div className="rounded-lg bg-melo/10 p-2 text-sm text-melo-dark">{err}</div> : null}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
          <Button disabled={busy || Number(amount) <= 0 || reason.trim().length < 3} onClick={submit} className="bg-melo hover:bg-melo-dark text-ivory">
            Registrar devolución
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Vista de cobros del barbero (solo los pagos de sus propias citas). */
export function MyPaymentsView({ user }: { user: SessionUser }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const h = () => setTick((n) => n + 1);
    window.addEventListener("melo:db-changed", h);
    return () => window.removeEventListener("melo:db-changed", h);
  }, []);

  const db = getDB();
  const rows = useMemo(() => {
    const myAppts = new Map(db.appointments.filter((a) => a.barberId === user.id).map((a) => [a.id, a]));
    return db.payments
      .filter((p) => myAppts.has(p.appointmentId))
      .filter((p) => (!from || new Date(p.receivedAt) >= new Date(`${from}T00:00:00-05:00`)) && (!to || new Date(p.receivedAt) < new Date(new Date(`${to}T00:00:00-05:00`).getTime() + 24 * 3600 * 1000)))
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  }, [tick, from, to]);

  const total = rows.reduce((s, p) => s + p.amount - p.refundedAmount, 0);

  return (
    <div>
      <SectionTitle title="Mis cobros" sub="Pagos registrados sobre tus propias citas. Cada pago que registras se suma automáticamente a la caja del propietario." />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <Label className="text-xs">Desde</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Hasta</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
        <div className="ml-auto rounded-xl bg-ivory px-4 py-2 text-sm"><span className="text-ink-soft">Cobrado en mis citas:</span> <b>{cop(total)}</b></div>
      </div>
      {rows.length === 0 ? <EmptyState title="Sin cobros registrados" sub="Registra el pago desde el detalle de una cita completada." /> : (
        <div className="grid gap-2">
          {rows.map((p) => {
            const appt = db.appointments.find((a) => a.id === p.appointmentId);
            const service = appt ? db.services.find((s) => s.id === appt.serviceId) : undefined;
            return (
              <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-ink/10 bg-ivory px-4 py-3 text-sm">
                <Wallet className="h-4 w-4 text-brass-dark" />
                <span className="font-medium">{appt?.code}</span>
                <span className="text-ink-soft">{service?.name} · {appt?.clientName}</span>
                <Chip>{METHOD_LABEL[p.method] ?? p.method}</Chip>
                <span className={cn("ml-auto font-bold tabular-nums", p.refundedAmount > 0 ? "text-melo-dark" : "text-good")}>
                  {cop(p.amount - p.refundedAmount)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
