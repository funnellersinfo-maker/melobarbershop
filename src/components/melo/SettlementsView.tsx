"use client";
// Liquidaciones de comisiones: borrador → aprobada → pagada (requisito C).
// Los totales los calcula el servidor; anticipos y devoluciones restan.
import { useMemo, useState } from "react";
import { api, useData } from "@/lib/api";
import { cop } from "@/lib/money";
import { fmtDateMedium, timeHMInBogota, dateKeyInBogota } from "@/lib/time";
import { SectionTitle, LoadingBlock, ErrorBlock, EmptyState, Chip, METHOD_LABEL } from "@/components/melo/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { HandCoins, Plus, BadgeCheck, Banknote, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SessionUser } from "@/components/melo/LoginView";

type SettlementRow = {
  id: string;
  code: string;
  status: "DRAFT" | "APPROVED" | "PAID";
  notes: string | null;
  totalCommissions: number;
  totalAdjustments: number;
  totalAmount: number;
  approvedAt: string | null;
  paidAt: string | null;
  paymentMethod: string | null;
  createdAt: string;
  barber: { id: string; name: string };
  approvedBy: { name: string } | null;
  items: Array<{
    itemType: string;
    label: string;
    amount: number;
    commission: { appointment: { code: string; service: { name: string } } } | null;
    adjustment: { type: string; reason: string } | null;
  }>;
};

type CommissionLite = { id: string; calculatedAmount: number; baseAmount: number; status: string; appointment: { code: string; service: { name: string }; completedAt: string | null } };
type AdjustmentLite = { id: string; type: string; amount: number; reason: string; status: string; createdAt: string };

export function SettlementsView({ user }: { user: SessionUser }) {
  const isOwner = user.role === "OWNER";
  const q = useData<{ settlements: SettlementRow[] }>("/api/settlements", []);
  const [newOpen, setNewOpen] = useState(false);
  const [detail, setDetail] = useState<SettlementRow | null>(null);

  const stats = useMemo(() => {
    const list = q.data?.settlements ?? [];
    return {
      totalPagado: list.filter((s) => s.status === "PAID").reduce((sum, s) => sum + s.totalAmount, 0),
      pendientes: list.filter((s) => s.status !== "PAID").length,
    };
  }, [q.data]);

  return (
    <div>
      <SectionTitle
        title={isOwner ? "Liquidaciones" : "Mis liquidaciones"}
        sub={
          isOwner
            ? "Cierra ciclos con cada barbero: selecciona comisiones pendientes y ajustes; los totales los calcula el servidor. Anticipos y devoluciones restan del total a pagar."
            : "Consulta tus liquidaciones. Por defecto no puedes aprobar las tuyas: lo hace el propietario (salvo permiso excepcional)."
        }
        right={
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-ivory px-4 py-2 text-sm"><span className="text-ink-soft">Pagado:</span> <b>{cop(stats.totalPagado)}</b></div>
            {isOwner ? (
              <Button onClick={() => setNewOpen(true)} className="bg-melo hover:bg-melo-dark text-ivory">
                <Plus className="mr-1 h-4 w-4" /> Nueva liquidación
              </Button>
            ) : null}
          </div>
        }
      />

      {q.loading ? <LoadingBlock /> : null}
      {q.error ? <ErrorBlock message={q.error} onRetry={q.reload} /> : null}
      {q.data && q.data.settlements.length === 0 ? (
        <EmptyState title="Sin liquidaciones" sub={isOwner ? "Crea la primera con el botón de arriba." : "El propietario creará liquidaciones con tus comisiones."} />
      ) : null}
      {q.data && q.data.settlements.length > 0 ? (
        <div className="grid gap-3">
          {q.data.settlements.map((s) => (
            <div key={s.id} className="rounded-2xl border border-ink/10 bg-ivory p-4">
              <div className="flex flex-wrap items-center gap-2">
                <HandCoins className="h-5 w-5 text-brass-dark" />
                <span className="font-display text-lg font-bold">{s.code}</span>
                <Chip>{s.barber.name}</Chip>
                <span className={cn("rounded-full border px-2 py-0.5 text-[11px]",
                  s.status === "PAID" ? "bg-good/15 text-good border-good/40" : s.status === "APPROVED" ? "bg-pole/10 text-pole border-pole/40" : "bg-warn/15 text-warn border-warn/40")}>
                  {s.status === "PAID" ? "pagada" : s.status === "APPROVED" ? "aprobada" : "borrador"}
                </span>
                <span className="ml-auto font-display text-xl font-bold tabular-nums">{cop(s.totalAmount)}</span>
              </div>
              <div className="mt-1 text-sm text-ink-soft">
                Comisiones {cop(s.totalCommissions)} · ajustes {s.totalAdjustments !== 0 ? `${s.totalAdjustments > 0 ? "+" : "−"} ${cop(Math.abs(s.totalAdjustments))}` : "0"}
                {s.paidAt ? ` · pagada ${fmtDateMedium(new Date(s.paidAt))}` : ""}
                {s.approvedBy ? ` · aprobó ${s.approvedBy.name}` : ""}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="border-ink/20" onClick={() => setDetail(s)}>
                  <ChevronDown className="mr-1 h-3 w-3" /> Detalle ({s.items.length} ítems)
                </Button>
                {isOwner && s.status === "DRAFT" ? (
                  <Button size="sm" className="bg-pole hover:bg-pole/80 text-ivory" onClick={() => act(s, "approve", "Liquidación aprobada")}>
                    <BadgeCheck className="mr-1 h-3 w-3" /> Aprobar
                  </Button>
                ) : null}
                {!isOwner && s.status === "DRAFT" && user.permissions?.["settlements.approveOwn"] ? (
                  <Button size="sm" className="bg-pole hover:bg-pole/80 text-ivory" onClick={() => act(s, "approve", "Liquidación aprobada (permiso propio)")}>
                    <BadgeCheck className="mr-1 h-3 w-3" /> Aprobar (permiso propio)
                  </Button>
                ) : null}
                {isOwner && s.status === "APPROVED" ? (
                  <PayDialog settlement={s} onPaid={() => q.reload()} />
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {newOpen ? (
        <NewSettlementDialog
          onClose={() => setNewOpen(false)}
          onCreated={() => { setNewOpen(false); q.reload(); toast({ title: "Borrador creado", description: "Revísalo, apruébalo y luego registra el pago." }); }}
        />
      ) : null}

      {detail ? (
        <Dialog open onOpenChange={(o) => (o ? undefined : setDetail(null))}>
          <DialogContent className="max-h-90 overflow-y-auto nice-scroll sm:max-w-2xl">
            <DialogHeader><DialogTitle>Detalle · {detail.code}</DialogTitle></DialogHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Concepto</TableHead>
                  <TableHead className="text-right">Efecto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.items.map((it, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-sm">{it.itemType === "COMMISSION" ? "Comisión" : it.itemType === "ADVANCE" ? "Anticipo" : it.itemType === "REFUND" ? "Devolución" : "Ajuste"}</TableCell>
                    <TableCell className="text-sm text-ink-soft">{it.label}</TableCell>
                    <TableCell className={cn("text-right font-semibold tabular-nums", it.amount >= 0 ? "text-good" : "text-melo-dark")}>
                      {it.amount >= 0 ? "+" : "−"} {cop(Math.abs(it.amount))}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="font-bold">Total</TableCell>
                  <TableCell />
                  <TableCell className="text-right font-display text-lg font-bold">{cop(detail.totalAmount)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
            {detail.notes ? <div className="mt-2 text-sm text-ink-soft">Notas: {detail.notes}</div> : null}
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );

  async function act(s: SettlementRow, action: "approve" | "pay", okMsg: string, extra?: Record<string, unknown>) {
    try {
      await api(`/api/settlements/${s.id}/${action}`, { method: "POST", body: JSON.stringify(extra ?? {}) });
      toast({ title: okMsg });
      q.reload();
    } catch (err) {
      toast({ title: "Acción rechazada", description: err instanceof Error ? err.message : "Error", variant: "destructive" });
    }
  }
}

function PayDialog({ settlement, onPaid }: { settlement: SettlementRow; onPaid: () => void }) {
  const [method, setMethod] = useState("CASH");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);

  async function pay() {
    setBusy(true);
    try {
      await api(`/api/settlements/${settlement.id}/pay`, { method: "POST", body: JSON.stringify({ method, externalRef: ref || null }) });
      toast({ title: "Liquidación pagada", description: `${settlement.code} · las comisiones incluidas quedaron pagadas.` });
      setOpen(false);
      onPaid();
    } catch (err) {
      toast({ title: "No se pudo pagar", description: err instanceof Error ? err.message : "Error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => setOpen(o)}>
      <DialogContent>
        <DialogHeader><DialogTitle>Pagar {settlement.code} · {cop(settlement.totalAmount)}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label>Método de pago</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(METHOD_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {method !== "CASH" ? (
            <div className="grid gap-1">
              <Label>Referencia (opcional)</Label>
              <Input value={ref} onChange={(e) => setRef(e.target.value)} />
            </div>
          ) : null}
          <p className="text-xs text-ink-soft">Al pagar, las comisiones incluidas pasan a “pagadas” y los ajustes a “liquidados”. El egreso queda en la caja.</p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button disabled={busy} onClick={pay} className="bg-good hover:bg-good/85 text-ivory"><Banknote className="mr-2 h-4 w-4" /> Pagar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NewSettlementDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const barbersQ = useData<{ barbers: Array<{ id: string; name: string }> }>("/api/commissions/config");
  const [barberId, setBarberId] = useState("");
  const commissionsQ = useData<{ commissions: CommissionLite[] }>(barberId ? `/api/commissions?barberId=${barberId}&status=PENDING_PAYMENT` : null, [barberId]);
  const adjustmentsQ = useData<{ adjustments: AdjustmentLite[] }>(barberId ? `/api/adjustments?barberId=${barberId}&status=PENDING` : null, [barberId]);
  const [selCommissions, setSelCommissions] = useState<Set<string>>(new Set());
  const [selAdjustments, setSelAdjustments] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const commissions = commissionsQ.data?.commissions ?? [];
  const adjustments = (adjustmentsQ.data?.adjustments ?? []).filter((a) => a.status === "PENDING");

  const totals = useMemo(() => {
    const cs = commissions.filter((c) => selCommissions.has(c.id));
    const as = adjustments.filter((a) => selAdjustments.has(a.id));
    const totalCommissions = cs.reduce((s, c) => s + c.calculatedAmount, 0);
    const totalAdjustments = as.reduce((s, a) => s + a.amount, 0);
    return { totalCommissions, totalAdjustments, total: totalCommissions + totalAdjustments, nC: cs.length, nA: as.length };
  }, [commissions, adjustments, selCommissions, selAdjustments]);

  function toggle(set: Set<string>, id: string, setter: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  }

  async function create() {
    setBusy(true);
    setErr(null);
    try {
      await api("/api/settlements", {
        method: "POST",
        body: JSON.stringify({
          barberId,
          commissionIds: Array.from(selCommissions),
          adjustmentIds: Array.from(selAdjustments),
          notes: notes || null,
          periodStart: null,
          periodEnd: null,
        }),
      });
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="max-h-92 overflow-y-auto nice-scroll sm:max-w-2xl">
        <DialogHeader><DialogTitle>Nueva liquidación</DialogTitle></DialogHeader>
        <div className="grid gap-1">
          <Label>Barbero</Label>
          <Select value={barberId} onValueChange={(v) => { setBarberId(v); setSelCommissions(new Set()); setSelAdjustments(new Set()); }}>
            <SelectTrigger><SelectValue placeholder="Elegir barbero" /></SelectTrigger>
            <SelectContent>
              {(barbersQ.data?.barbers ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {barberId ? (
          <>
            <div>
              <div className="mb-2 mt-3 text-sm font-semibold">Comisiones pendientes ({commissions.length})</div>
              {commissions.length === 0 ? (
                <div className="rounded-lg border border-dashed border-ink/15 px-3 py-4 text-sm text-ink-soft">Sin comisiones pendientes.</div>
              ) : (
                <div className="grid max-h-56 gap-1 overflow-y-auto pr-1 nice-scroll">
                  {commissions.map((c) => (
                    <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-ink/10 bg-cream px-3 py-2 text-sm">
                      <Checkbox checked={selCommissions.has(c.id)} onCheckedChange={() => toggle(selCommissions, c.id, setSelCommissions)} />
                      <span className="font-medium">{c.appointment.code}</span>
                      <span className="text-ink-soft">{c.appointment.service.name}</span>
                      <span className="ml-auto font-bold tabular-nums">{cop(c.calculatedAmount)}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="mb-2 mt-3 text-sm font-semibold">Ajustes pendientes (anticipos / devoluciones / manuales)</div>
              {adjustments.length === 0 ? (
                <div className="rounded-lg border border-dashed border-ink/15 px-3 py-4 text-sm text-ink-soft">Sin ajustes pendientes.</div>
              ) : (
                <div className="grid gap-1">
                  {adjustments.map((a) => (
                    <label key={a.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-ink/10 bg-cream px-3 py-2 text-sm">
                      <Checkbox checked={selAdjustments.has(a.id)} onCheckedChange={() => toggle(selAdjustments, a.id, setSelAdjustments)} />
                      <Chip>{a.type === "ADVANCE" ? "anticipo" : a.type === "REFUND" ? "devolución" : "manual"}</Chip>
                      <span className="text-ink-soft">{a.reason}</span>
                      <span className={cn("ml-auto font-bold tabular-nums", a.amount < 0 ? "text-melo-dark" : "text-good")}>
                        {a.amount >= 0 ? "+" : "−"} {cop(Math.abs(a.amount))}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-brass/40 bg-brass/5 p-4">
              <div className="flex justify-between text-sm"><span className="text-ink-soft">Comisiones ({totals.nC})</span><b>{cop(totals.totalCommissions)}</b></div>
              <div className="flex justify-between text-sm"><span className="text-ink-soft">Ajustes ({totals.nA})</span><b>{totals.totalAdjustments >= 0 ? "+" : "−"} {cop(Math.abs(totals.totalAdjustments))}</b></div>
              <div className="mt-2 flex justify-between border-t border-brass/30 pt-2">
                <span className="font-semibold">Total a pagar</span>
                <span className="font-display text-2xl font-bold">{cop(totals.total)}</span>
              </div>
            </div>

            <div className="grid gap-1">
              <Label>Notas (opcional)</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej: corte de semana 44" />
            </div>
            {err ? <div className="rounded-lg bg-melo/10 p-2 text-sm text-melo-dark">{err}</div> : null}
          </>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={busy || !barberId || (selCommissions.size === 0 && selAdjustments.size === 0) || totals.total < 0} onClick={create} className="bg-melo hover:bg-melo-dark text-ivory">
            Crear borrador
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
