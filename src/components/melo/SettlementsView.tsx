"use client";
// Liquidaciones: borrador → aprobada → pagada, con Excel.
import { useEffect, useMemo, useState } from "react";
import { cop } from "@/lib/money";
import { fmtDateMedium } from "@/lib/time";
import { getDB, type SessionUser } from "@/lib/store";
import { createSettlement, approveSettlement, paySettlement } from "@/lib/engines/finance";
import { SectionTitle, EmptyState, Chip, METHOD_LABEL } from "@/components/melo/ui";
import { exportSettlementsExcel } from "@/lib/excel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { HandCoins, Plus, BadgeCheck, Banknote, ChevronDown, FileDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function SettlementsView({ user }: { user: SessionUser }) {
  const isOwner = user.role === "OWNER";
  const [tick, setTick] = useState(0);
  const [newOpen, setNewOpen] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    const h = () => setTick((n) => n + 1);
    window.addEventListener("melo:db-changed", h);
    return () => window.removeEventListener("melo:db-changed", h);
  }, []);

  const db = getDB();
  const settlements = useMemo(
    () => db.settlements.filter((s) => (isOwner ? true : s.barberId === user.id)),
    [tick, isOwner]
  );

  const stats = useMemo(() => ({
    totalPagado: settlements.filter((s) => s.status === "PAID").reduce((sum, s) => sum + s.totalAmount, 0),
    pendientes: settlements.filter((s) => s.status !== "PAID").length,
  }), [settlements]);

  function act(fn: () => void, okMsg: string) {
    try {
      fn();
      toast({ title: okMsg });
      setTick((n) => n + 1);
    } catch (err) {
      toast({ title: "Acción rechazada", description: err instanceof Error ? err.message : "Error", variant: "destructive" });
    }
  }

  function downloadExcel() {
    exportSettlementsExcel(
      settlements.map((s) => ({
        codigo: s.code,
        barbero: db.barbers.find((b) => b.id === s.barberId)?.name ?? "—",
        estado: s.status === "PAID" ? "Pagada" : s.status === "APPROVED" ? "Aprobada" : "Borrador",
        comisiones: s.totalCommissions,
        ajustes: s.totalAdjustments,
        total: s.totalAmount,
        aprobada: s.approvedAt ? fmtDateMedium(new Date(s.approvedAt)) : "",
        pagada: s.paidAt ? fmtDateMedium(new Date(s.paidAt)) : "",
        metodo: s.paymentMethod ? (METHOD_LABEL[s.paymentMethod] ?? s.paymentMethod) : "",
        items: s.items.map((it) => `${it.label} (${it.amount >= 0 ? "+" : "−"}${cop(Math.abs(it.amount))})`).join(" | "),
      }))
    );
    toast({ title: "Excel generado" });
  }

  const detailSettlement = detail ? db.settlements.find((s) => s.id === detail) : null;

  return (
    <div>
      <SectionTitle
        title={isOwner ? "Liquidaciones" : "Mis liquidaciones"}
        sub={
          isOwner
            ? "Cierra ciclos con cada barbero: selecciona comisiones pendientes y ajustes. Anticipos y devoluciones restan del total a pagar."
            : "Consulta tus liquidaciones. Por defecto las aprueba el propietario (salvo permiso excepcional)."
        }
        right={
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-ivory px-4 py-2 text-sm"><span className="text-ink-soft">Pagado:</span> <b>{cop(stats.totalPagado)}</b></div>
            <Button variant="outline" onClick={downloadExcel} disabled={settlements.length === 0} className="border-good/50 text-good hover:bg-good/10">
              <FileDown className="mr-1 h-4 w-4" /> Excel
            </Button>
            {isOwner ? (
              <Button onClick={() => setNewOpen(true)} className="bg-melo hover:bg-melo-dark text-ivory">
                <Plus className="mr-1 h-4 w-4" /> Nueva liquidación
              </Button>
            ) : null}
          </div>
        }
      />

      {settlements.length === 0 ? (
        <EmptyState title="Sin liquidaciones" sub={isOwner ? "Crea la primera con el botón de arriba." : "El propietario creará liquidaciones con tus comisiones."} />
      ) : (
        <div className="grid gap-3">
          {settlements.map((s) => {
            const barber = db.barbers.find((b) => b.id === s.barberId);
            const canApproveOwn = !isOwner && !!barber?.permissions["settlements.approveOwn"];
            return (
              <div key={s.id} className="rounded-2xl border border-ink/10 bg-ivory p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <HandCoins className="h-5 w-5 text-brass-dark" />
                  <span className="font-display text-lg font-bold">{s.code}</span>
                  <Chip>{barber?.name ?? "—"}</Chip>
                  <span className={cn("rounded-full border px-2 py-0.5 text-[11px]",
                    s.status === "PAID" ? "bg-good/15 text-good border-good/40" : s.status === "APPROVED" ? "bg-pole/10 text-pole border-pole/40" : "bg-warn/15 text-warn border-warn/40")}>
                    {s.status === "PAID" ? "pagada" : s.status === "APPROVED" ? "aprobada" : "borrador"}
                  </span>
                  <span className="ml-auto font-display text-xl font-bold tabular-nums">{cop(s.totalAmount)}</span>
                </div>
                <div className="mt-1 text-sm text-ink-soft">
                  Comisiones {cop(s.totalCommissions)} · ajustes {s.totalAdjustments !== 0 ? `${s.totalAdjustments > 0 ? "+" : "−"} ${cop(Math.abs(s.totalAdjustments))}` : "0"}
                  {s.paidAt ? ` · pagada ${fmtDateMedium(new Date(s.paidAt))}` : ""}
                  {s.approvedByName ? ` · aprobó ${s.approvedByName}` : ""}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="border-ink/20" onClick={() => setDetail(s.id)}>
                    <ChevronDown className="mr-1 h-3 w-3" /> Detalle ({s.items.length} ítems)
                  </Button>
                  {isOwner && s.status === "DRAFT" ? (
                    <Button size="sm" className="bg-pole hover:bg-pole/80 text-ivory" onClick={() => act(() => approveSettlement(s.id, user.name, false), "Liquidación aprobada")}>
                      <BadgeCheck className="mr-1 h-3 w-3" /> Aprobar
                    </Button>
                  ) : null}
                  {!isOwner && s.status === "DRAFT" && canApproveOwn ? (
                    <Button size="sm" className="bg-pole hover:bg-pole/80 text-ivory" onClick={() => act(() => approveSettlement(s.id, user.name, true), "Liquidación aprobada (permiso propio)")}>
                      <BadgeCheck className="mr-1 h-3 w-3" /> Aprobar (permiso propio)
                    </Button>
                  ) : null}
                  {isOwner && s.status === "APPROVED" ? (
                    <PayDialog settlement={s} onPaid={() => setTick((n) => n + 1)} />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {newOpen ? (
        <NewSettlementDialog
          onClose={() => setNewOpen(false)}
          onCreated={() => { setNewOpen(false); setTick((n) => n + 1); toast({ title: "Borrador creado", description: "Revísalo, apruébalo y luego registra el pago." }); }}
        />
      ) : null}

      {detailSettlement ? (
        <Dialog open onOpenChange={(o) => (o ? undefined : setDetail(null))}>
          <DialogContent className="max-h-90 overflow-y-auto nice-scroll sm:max-w-2xl">
            <DialogHeader><DialogTitle>Detalle · {detailSettlement.code}</DialogTitle></DialogHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Concepto</TableHead>
                  <TableHead className="text-right">Efecto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detailSettlement.items.map((it, i) => (
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
                  <TableCell className="text-right font-display text-lg font-bold">{cop(detailSettlement.totalAmount)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
            {detailSettlement.notes ? <div className="mt-2 text-sm text-ink-soft">Notas: {detailSettlement.notes}</div> : null}
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

function PayDialog({ settlement, onPaid }: { settlement: ReturnType<typeof getDB>["settlements"][number]; onPaid: () => void }) {
  const [method, setMethod] = useState("CASH");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);

  async function pay() {
    setBusy(true);
    try {
      paySettlement(settlement.id, method, ref || null, "Propietario");
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
  const db = getDB();
  const [barberId, setBarberId] = useState("");
  const [selCommissions, setSelCommissions] = useState<Set<string>>(new Set());
  const [selAdjustments, setSelAdjustments] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const commissions = db.commissions.filter((c) => c.barberId === barberId && c.status === "PENDING_PAYMENT");
  const adjustments = db.adjustments.filter((a) => a.barberId === barberId && a.status === "PENDING");

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
      createSettlement(barberId, Array.from(selCommissions), Array.from(selAdjustments), notes || null, "Propietario");
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
              {db.barbers.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
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
                  {commissions.map((c) => {
                    const appt = db.appointments.find((a) => a.id === c.appointmentId);
                    return (
                      <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-ink/10 bg-cream px-3 py-2 text-sm">
                        <Checkbox checked={selCommissions.has(c.id)} onCheckedChange={() => toggle(selCommissions, c.id, setSelCommissions)} />
                        <span className="font-medium">{appt?.code}</span>
                        <span className="text-ink-soft">{c.snapshot.serviceName}</span>
                        <span className="ml-auto font-bold tabular-nums">{cop(c.calculatedAmount)}</span>
                      </label>
                    );
                  })}
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
