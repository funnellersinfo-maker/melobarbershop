"use client";
// Ajustes (anticipos, devoluciones, manuales) y Gastos operativos del propietario.
import { useState } from "react";
import { api, useData } from "@/lib/api";
import { cop } from "@/lib/money";
import { fmtDateMedium } from "@/lib/time";
import { SectionTitle, LoadingBlock, ErrorBlock, EmptyState, Chip, CATEGORY_LABEL } from "@/components/melo/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { SlidersHorizontal, Plus, Receipt, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

type AdjustmentRow = {
  id: string;
  type: "ADVANCE" | "REFUND" | "MANUAL";
  amount: number;
  reason: string;
  status: "PENDING" | "SETTLED";
  appointmentCode: string | null;
  createdAt: string;
  barber: { id: string; name: string };
  createdBy: { name: string };
};

export function AdjustmentsView() {
  const barbersQ = useData<{ barbers: Array<{ id: string; name: string }> }>("/api/commissions/config");
  const [status, setStatus] = useState("");
  const q = useData<{ adjustments: AdjustmentRow[] }>(`/api/adjustments${status ? `?status=${status}` : ""}`, [status]);
  const [open, setOpen] = useState(false);

  const totalPendiente = (q.data?.adjustments ?? []).filter((a) => a.status === "PENDING").reduce((s, a) => s + a.amount, 0);

  return (
    <div>
      <SectionTitle
        title="Ajustes de comisiones"
        sub="Anticipos (restan en la próxima liquidación), devoluciones y ajustes manuales. Todos con motivo y registro de auditoría; nunca modifican comisiones históricas en silencio."
        right={
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-ivory px-4 py-2 text-sm"><span className="text-ink-soft">Pendiente en ajustes:</span> <b>{cop(totalPendiente)}</b></div>
            <Button onClick={() => setOpen(true)} className="bg-melo hover:bg-melo-dark text-ivory"><Plus className="mr-1 h-4 w-4" /> Nuevo ajuste</Button>
          </div>
        }
      />

      <div className="mb-3">
        <Select value={status || "ALL"} onValueChange={(v) => setStatus(v === "ALL" ? "" : v)}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Todos los estados</SelectItem>
            <SelectItem value="PENDING">Pendientes</SelectItem>
            <SelectItem value="SETTLED">Liquidados</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {q.loading ? <LoadingBlock /> : null}
      {q.error ? <ErrorBlock message={q.error} onRetry={q.reload} /> : null}
      {q.data && q.data.adjustments.length === 0 ? (
        <EmptyState icon={<SlidersHorizontal className="h-8 w-8" />} title="Sin ajustes" sub="Registra anticipos o devoluciones cuando ocurran." />
      ) : null}
      {q.data && q.data.adjustments.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-ink/10 bg-ivory">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Barbero</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead>Cita</TableHead>
                <TableHead className="text-right">Efecto</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.adjustments.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="text-sm">{fmtDateMedium(new Date(a.createdAt))}</TableCell>
                  <TableCell className="text-sm">{a.barber.name}</TableCell>
                  <TableCell><Chip>{a.type === "ADVANCE" ? "anticipo" : a.type === "REFUND" ? "devolución" : "manual"}</Chip></TableCell>
                  <TableCell className="text-sm text-ink-soft">{a.reason}</TableCell>
                  <TableCell className="text-sm">{a.appointmentCode ?? "—"}</TableCell>
                  <TableCell className={cn("text-right font-bold tabular-nums", a.amount < 0 ? "text-melo-dark" : "text-good")}>
                    {a.amount >= 0 ? "+" : "−"} {cop(Math.abs(a.amount))}
                  </TableCell>
                  <TableCell>
                    <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", a.status === "SETTLED" ? "bg-good/15 text-good border-good/40" : "bg-warn/15 text-warn border-warn/40")}>
                      {a.status === "SETTLED" ? "liquidado" : "pendiente"}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {open ? (
        <NewAdjustmentDialog
          barbers={barbersQ.data?.barbers ?? []}
          onClose={() => setOpen(false)}
          onCreated={() => { setOpen(false); q.reload(); toast({ title: "Ajuste registrado", description: "Quedó con motivo y auditoría." }); }}
        />
      ) : null}
    </div>
  );
}

function NewAdjustmentDialog({ barbers, onClose, onCreated }: { barbers: Array<{ id: string; name: string }>; onClose: () => void; onCreated: () => void }) {
  const [barberId, setBarberId] = useState("");
  const [type, setType] = useState<"ADVANCE" | "REFUND" | "MANUAL">("ADVANCE");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setErr(null);
    try {
      await api("/api/adjustments", {
        method: "POST",
        body: JSON.stringify({ barberId, type, amount: Number(amount), reason }),
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
      <DialogContent>
        <DialogHeader><DialogTitle>Nuevo ajuste</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label>Barbero</Label>
            <Select value={barberId} onValueChange={setBarberId}>
              <SelectTrigger><SelectValue placeholder="Elegir" /></SelectTrigger>
              <SelectContent>{barbers.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label>Tipo</Label>
            <Select value={type} onValueChange={(v) => setType(v as "ADVANCE" | "REFUND" | "MANUAL")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ADVANCE">Anticipo (resta en la liquidación)</SelectItem>
                <SelectItem value="REFUND">Devolución que reduce la comisión</SelectItem>
                <SelectItem value="MANUAL">Ajuste manual (suma o resta)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label>{type === "MANUAL" ? "Valor con signo (negativo resta)" : "Valor (COP)"}</Label>
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={type === "MANUAL" ? "Ej: -5000 o 8000" : "Ej: 20000"} />
          </div>
          <div className="grid gap-1">
            <Label>Motivo (obligatorio)</Label>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej: anticipo para transporte" />
          </div>
          {err ? <div className="rounded-lg bg-melo/10 p-2 text-sm text-melo-dark">{err}</div> : null}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={busy || !barberId || !amount || Number(amount) === 0 || reason.trim().length < 3} onClick={create} className="bg-ink hover:bg-ink/80 text-ivory">
            Registrar ajuste
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type ExpenseRow = {
  id: string;
  description: string;
  category: string;
  amount: number;
  method: string | null;
  notes: string | null;
  spentAt: string;
  createdBy: { name: string };
};

export function ExpensesView() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const q = useData<{ expenses: ExpenseRow[]; categories: string[] }>(`/api/expenses${from || to ? `?${from ? `from=${from}` : ""}${from && to ? "&" : ""}${to ? `to=${to}` : ""}` : ""}`, [from, to]);
  const [open, setOpen] = useState(false);
  const [editFor, setEditFor] = useState<ExpenseRow | null>(null);

  const total = (q.data?.expenses ?? []).reduce((s, e) => s + e.amount, 0);
  const byCat = new Map<string, number>();
  for (const e of q.data?.expenses ?? []) byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount);

  return (
    <div>
      <SectionTitle
        title="Gastos operativos"
        sub="Egresos del negocio a cargo del propietario. Entran al flujo de caja y al resultado operativo del período."
        right={
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-ivory px-4 py-2 text-sm"><span className="text-ink-soft">Total:</span> <b>{cop(total)}</b></div>
            <Button onClick={() => setOpen(true)} className="bg-melo hover:bg-melo-dark text-ivory"><Plus className="mr-1 h-4 w-4" /> Registrar gasto</Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="grid gap-1"><Label className="text-xs">Desde</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></div>
        <div className="grid gap-1"><Label className="text-xs">Hasta</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
        <div className="ml-auto flex flex-wrap gap-2">
          {Array.from(byCat.entries()).map(([c, v]) => (
            <Chip key={c}>{CATEGORY_LABEL[c] ?? c}: {cop(v)}</Chip>
          ))}
        </div>
      </div>

      {q.loading ? <LoadingBlock /> : null}
      {q.error ? <ErrorBlock message={q.error} onRetry={q.reload} /> : null}
      {q.data && q.data.expenses.length === 0 ? (
        <EmptyState icon={<Receipt className="h-8 w-8" />} title="Sin gastos en el rango" sub="Registra alquiler, insumos, servicios y demás egresos." />
      ) : null}
      {q.data && q.data.expenses.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-ink/10 bg-ivory">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead className="text-right">Monto</TableHead>
                <TableHead>Registró</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.expenses.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-sm">{fmtDateMedium(new Date(e.spentAt))}</TableCell>
                  <TableCell className="text-sm">{e.description}{e.notes ? <span className="block text-xs text-ink-soft">{e.notes}</span> : null}</TableCell>
                  <TableCell><Chip>{CATEGORY_LABEL[e.category] ?? e.category}</Chip></TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{cop(e.amount)}</TableCell>
                  <TableCell className="text-sm text-ink-soft">{e.createdBy.name}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-7" onClick={() => setEditFor(e)}><Pencil className="h-3 w-3" /></Button>
                      <Button
                        size="sm" variant="ghost" className="h-7 text-melo-dark"
                        onClick={async () => {
                          try {
                            await api(`/api/expenses/${e.id}`, { method: "DELETE" });
                            toast({ title: "Gasto eliminado", description: "Queda en auditoría con el valor anterior." });
                            q.reload();
                          } catch (err) {
                            toast({ title: "No se pudo eliminar", description: err instanceof Error ? err.message : "", variant: "destructive" });
                          }
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {open ? (
        <ExpenseDialog categories={q.data?.categories ?? []} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); q.reload(); toast({ title: "Gasto registrado" }); }} />
      ) : null}
      {editFor ? (
        <ExpenseDialog categories={q.data?.categories ?? []} existing={editFor} onClose={() => setEditFor(null)} onSaved={() => { setEditFor(null); q.reload(); toast({ title: "Gasto actualizado" }); }} />
      ) : null}
    </div>
  );
}

function ExpenseDialog({
  categories, existing, onClose, onSaved,
}: {
  categories: string[];
  existing?: ExpenseRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [description, setDescription] = useState(existing?.description ?? "");
  const [category, setCategory] = useState(existing?.category ?? "INSUMOS");
  const [amount, setAmount] = useState(existing ? String(existing.amount) : "");
  const [date, setDate] = useState(existing ? existing.spentAt.slice(0, 10) : "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const body = JSON.stringify({
        description, category, amount: Number(amount), notes: notes || null,
        date: date || undefined,
      });
      await api(existing ? `/api/expenses/${existing.id}` : "/api/expenses", {
        method: existing ? "PATCH" : "POST",
        body,
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader><DialogTitle>{existing ? "Editar gasto" : "Registrar gasto"}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label>Descripción</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ej: compra de toallas" />
          </div>
          <div className="grid gap-1 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label>Categoría</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {categories.map((c) => <SelectItem key={c} value={c}>{CATEGORY_LABEL[c] ?? c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label>Monto (COP)</Label>
              <Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label>Fecha</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1">
            <Label>Notas (opcional)</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {err ? <div className="rounded-lg bg-melo/10 p-2 text-sm text-melo-dark">{err}</div> : null}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={busy || !description || !amount} onClick={save} className="bg-ink hover:bg-ink/80 text-ivory">
            {existing ? "Guardar cambios" : "Registrar gasto"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
