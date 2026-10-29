"use client";
// Pagos y caja del propietario: registro, devoluciones, movimientos y conciliación (requisito D).
import { useMemo, useState } from "react";
import { api, useData } from "@/lib/api";
import { cop } from "@/lib/money";
import { timeHMInBogota, fmtDateMedium, dateKeyInBogota } from "@/lib/time";
import { SectionTitle, LoadingBlock, ErrorBlock, EmptyState, Chip, METHOD_LABEL, PAY_STATUS_META } from "@/components/melo/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { Wallet, RotateCcw, Plus, ArrowDownRight, ArrowUpRight, Landmark } from "lucide-react";
import { cn } from "@/lib/utils";

type PaymentRow = {
  id: string;
  appointmentId: string;
  amount: number;
  method: string;
  status: string;
  refundedAmount: number;
  externalRef: string | null;
  notes: string | null;
  refundReason: string | null;
  receivedAt: string;
  appointment: { code: string; clientName: string; priceSnapshot: number; discount: number; service: { name: string }; barber: { id: string; name: string } };
  registeredBy: { name: string };
};

type Movement = { date: string; kind: "INGRESO" | "EGRESO"; concept: string; detail: string; amount: number; source: string; method?: string };

export function PaymentsView({ user }: { user: { role: string; id: string; name: string } }) {
  const [from, setFrom] = useState(dateKeyInBogota(new Date()));
  const [to, setTo] = useState(dateKeyInBogota(new Date()));
  const payQ = useData<{ payments: PaymentRow[] }>(`/api/payments?from=${from}&to=${to}`, [from, to]);
  const cashQ = useData<{ movements: Movement[]; balance: number }>(`/api/cash?from=${from}&to=${to}`, [from, to]);
  const [refundFor, setRefundFor] = useState<PaymentRow | null>(null);

  const totals = useMemo(() => {
    const list = payQ.data?.payments ?? [];
    const cobrado = list.reduce((s, p) => s + (p.amount - p.refundedAmount), 0);
    const devuelto = list.reduce((s, p) => s + p.refundedAmount, 0);
    return { n: list.length, cobrado, devuelto };
  }, [payQ.data]);

  return (
    <div>
      <SectionTitle title="Pagos y caja" sub="El pago se registra aparte de la cita completada. La caja consolida ingresos por pagos y egresos por gastos, anticipos y liquidaciones." />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <Label className="text-xs">Desde</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Hasta</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
        <div className="ml-auto flex gap-2 rounded-xl bg-ivory px-4 py-2 text-sm">
          <span className="text-ink-soft">Cobrado neto:</span> <b>{cop(totals.cobrado)}</b>
          <span className="text-ink-soft ml-3">Devuelto:</span> <b>{cop(totals.devuelto)}</b>
        </div>
      </div>

      <Tabs defaultValue="payments">
        <TabsList className="bg-ivory">
          <TabsTrigger value="payments">Pagos registrados</TabsTrigger>
          <TabsTrigger value="cash">Movimientos de caja</TabsTrigger>
        </TabsList>

        <TabsContent value="payments" className="mt-4">
          {payQ.loading ? <LoadingBlock /> : payQ.error ? <ErrorBlock message={payQ.error} onRetry={payQ.reload} /> : null}
          {payQ.data && payQ.data.payments.length === 0 ? (
            <EmptyState title="Sin pagos en el rango" sub="Los pagos se registran desde el detalle de una cita completada." />
          ) : null}
          {payQ.data && payQ.data.payments.length > 0 ? (
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
                  {payQ.data.payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-sm">{fmtDateMedium(new Date(p.receivedAt))} {timeHMInBogota(new Date(p.receivedAt))}</TableCell>
                      <TableCell className="font-medium">{p.appointment.code}</TableCell>
                      <TableCell>{p.appointment.clientName}</TableCell>
                      <TableCell className="text-sm text-ink-soft">{p.appointment.barber.name}</TableCell>
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
          ) : null}
        </TabsContent>

        <TabsContent value="cash" className="mt-4">
          {cashQ.loading ? <LoadingBlock /> : cashQ.error ? <ErrorBlock message={cashQ.error} onRetry={cashQ.reload} /> : null}
          {cashQ.data ? (
            <>
              <div className="mb-4 flex items-center gap-3 rounded-xl border border-ink/10 bg-ivory px-5 py-4">
                <Landmark className="h-6 w-6 text-brass-dark" />
                <div>
                  <div className="text-xs uppercase tracking-wide text-ink-soft">Balance del período</div>
                  <div className={cn("font-display text-2xl font-bold", cashQ.data.balance >= 0 ? "text-good" : "text-melo-dark")}>
                    {cop(cashQ.data.balance)}
                  </div>
                </div>
              </div>
              {cashQ.data.movements.length === 0 ? (
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
                      {cashQ.data.movements.map((m, i) => (
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
            </>
          ) : null}
        </TabsContent>
      </Tabs>

      {refundFor ? (
        <RefundDialog
          payment={refundFor}
          onClose={() => setRefundFor(null)}
          onDone={() => { setRefundFor(null); payQ.reload(); cashQ.reload(); }}
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
      await api(`/api/payments/${payment.id}/refund`, {
        method: "POST",
        body: JSON.stringify({ amount: Number(amount), reason }),
      });
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
          <DialogTitle>Devolución · {payment.appointment.code}</DialogTitle>
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
export function MyPaymentsView() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const payQ = useData<{ payments: PaymentRow[] }>(`/api/payments${from ? `?from=${from}` : ""}${to ? `${from ? "&" : "?"}to=${to}` : ""}`, [from, to]);
  const total = (payQ.data?.payments ?? []).reduce((s, p) => s + (p.amount - p.refundedAmount), 0);

  return (
    <div>
      <SectionTitle title="Mis cobros" sub="Pagos registrados sobre tus propias citas. El dinero de la caja lo consolida el propietario." />
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
      {payQ.loading ? <LoadingBlock /> : null}
      {payQ.error ? <ErrorBlock message={payQ.error} onRetry={payQ.reload} /> : null}
      {payQ.data && payQ.data.payments.length === 0 ? <EmptyState title="Sin cobros registrados" sub="Registra el pago desde el detalle de una cita completada." /> : null}
      {payQ.data && payQ.data.payments.length > 0 ? (
        <div className="grid gap-2">
          {payQ.data.payments.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-ink/10 bg-ivory px-4 py-3 text-sm">
              <Wallet className="h-4 w-4 text-brass-dark" />
              <span className="font-medium">{p.appointment.code}</span>
              <span className="text-ink-soft">{p.appointment.service.name} · {p.appointment.clientName}</span>
              <Chip>{METHOD_LABEL[p.method] ?? p.method}</Chip>
              <span className={cn("ml-auto font-bold tabular-nums", p.refundedAmount > 0 ? "text-melo-dark" : "text-good")}>
                {cop(p.amount - p.refundedAmount)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
