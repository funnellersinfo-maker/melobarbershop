"use client";
// Ajustes (anticipos, devoluciones, manuales) y Gastos operativos del propietario.
import { useEffect, useMemo, useState } from "react";
import { cop } from "@/lib/money";
import { fmtDateMedium } from "@/lib/time";
import { getDB, mutateDB, audit, cuid, type Adjustment, type Expense } from "@/lib/store";
import { SectionTitle, EmptyState, Chip, CATEGORY_LABEL } from "@/components/melo/ui";
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

export function AdjustmentsView() {
  const [tick, setTick] = useState(0);
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const h = () => setTick((n) => n + 1);
    window.addEventListener("melo:db-changed", h);
    return () => window.removeEventListener("melo:db-changed", h);
  }, []);

  const db = getDB();
  const adjustments = useMemo(
    () => db.adjustments.filter((a) => (status ? a.status === status : true)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [tick, status]
  );
  const totalPendiente = db.adjustments.filter((a) => a.status === "PENDING").reduce((s, a) => s + a.amount, 0);

  function create(barberId: string, type: Adjustment["type"], amount: number, reason: string) {
    let signed = Math.round(amount);
    if (type === "ADVANCE") signed = -Math.abs(Math.round(amount));
    if (type === "REFUND") signed = -Math.abs(Math.round(amount));
    mutateDB((d) => {
      d.adjustments.unshift({
        id: cuid("adj"),
        barberId,
        type,
        amount: signed,
        reason: reason.trim(),
        status: "PENDING",
        createdByName: "Propietario",
        createdAt: new Date().toISOString(),
      });
    });
    audit("ADJUSTMENT", barberId, "CREATE", "Propietario", null, { type, amount: signed, reason });
    setTick((n) => n + 1);
    toast({ title: "Ajuste registrado", description: "Quedó con motivo y auditoría." });
  }

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

      {adjustments.length === 0 ? (
        <EmptyState icon={<SlidersHorizontal className="h-8 w-8" />} title="Sin ajustes" sub="Registra anticipos o devoluciones cuando ocurran." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-ink/10 bg-ivory">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Barbero</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead className="text-right">Efecto</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {adjustments.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="text-sm">{fmtDateMedium(new Date(a.createdAt))}</TableCell>
                  <TableCell className="text-sm">{db.barbers.find((b) => b.id === a.barberId)?.name ?? "—"}</TableCell>
                  <TableCell><Chip>{a.type === "ADVANCE" ? "anticipo" : a.type === "REFUND" ? "devolución" : "manual"}</Chip></TableCell>
                  <TableCell className="text-sm text-ink-soft">{a.reason}</TableCell>
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
      )}

      {open ? (
        <NewAdjustmentDialog
          barbers={db.barbers}
          onClose={() => setOpen(false)}
          onCreated={() => { setOpen(false); }}
          onCreate={create}
        />
      ) : null}
    </div>
  );
}

function NewAdjustmentDialog({ barbers, onClose, onCreated, onCreate }: {
  barbers: Array<{ id: string; name: string }>;
  onClose: () => void; onCreated: () => void;
  onCreate: (barberId: string, type: Adjustment["type"], amount: number, reason: string) => void;
}) {
  const [barberId, setBarberId] = useState("");
  const [type, setType] = useState<Adjustment["type"]>("ADVANCE");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);

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
            <Select value={type} onValueChange={(v) => setType(v as Adjustment["type"])}>
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
          <Button
            disabled={!barberId || !amount || Number(amount) === 0 || reason.trim().length < 3}
            onClick={() => {
              const n = Number(amount);
              if (!Number.isFinite(n) || n === 0) { setErr("Valor inválido"); return; }
              if (type === "ADVANCE" && n < 0) { setErr("Para anticipo usa valor positivo (se resta automáticamente)"); return; }
              onCreate(barberId, type, n, reason);
              onCreated();
            }}
            className="bg-ink hover:bg-ink/80 text-ivory"
          >
            Registrar ajuste
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================ GASTOS
export function ExpensesView() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState(false);
  const [editFor, setEditFor] = useState<Expense | null>(null);

  useEffect(() => {
    const h = () => setTick((n) => n + 1);
    window.addEventListener("melo:db-changed", h);
    return () => window.removeEventListener("melo:db-changed", h);
  }, []);

  const db = getDB();
  const expenses = useMemo(() => {
    return db.expenses
      .filter((e) => (!from || e.spentAt >= `${from}T00:00:00-05:00`) && (!to || e.spentAt < new Date(new Date(`${to}T00:00:00-05:00`).getTime() + 24 * 3600 * 1000).toISOString()))
      .sort((a, b) => b.spentAt.localeCompare(a.spentAt));
  }, [tick, from, to]);

  const total = expenses.reduce((s, e) => s + e.amount, 0);
  const byCat = new Map<string, number>();
  for (const e of expenses) byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount);

  function save(expense: Omit<Expense, "id">, existingId?: string) {
    mutateDB((d) => {
      if (existingId) {
        const idx = d.expenses.findIndex((e) => e.id === existingId);
        if (idx >= 0) d.expenses[idx] = { ...d.expenses[idx], ...expense };
      } else {
        d.expenses.unshift({ ...expense, id: cuid("exp") });
      }
    });
    audit("EXPENSE", existingId ?? "new", existingId ? "UPDATE" : "CREATE", "Propietario", null, expense);
    setTick((n) => n + 1);
    toast({ title: existingId ? "Gasto actualizado" : "Gasto registrado" });
  }

  function remove(id: string) {
    const before = db.expenses.find((e) => e.id === id);
    mutateDB((d) => {
      d.expenses = d.expenses.filter((e) => e.id !== id);
    });
    audit("EXPENSE", id, "DELETE", "Propietario", before, null);
    setTick((n) => n + 1);
    toast({ title: "Gasto eliminado", description: "Queda en auditoría con el valor anterior." });
  }

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

      {expenses.length === 0 ? (
        <EmptyState icon={<Receipt className="h-8 w-8" />} title="Sin gastos en el rango" sub="Registra alquiler, insumos, servicios y demás egresos." />
      ) : (
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
              {expenses.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-sm">{fmtDateMedium(new Date(e.spentAt))}</TableCell>
                  <TableCell className="text-sm">{e.description}{e.notes ? <span className="block text-xs text-ink-soft">{e.notes}</span> : null}</TableCell>
                  <TableCell><Chip>{CATEGORY_LABEL[e.category] ?? e.category}</Chip></TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{cop(e.amount)}</TableCell>
                  <TableCell className="text-sm text-ink-soft">{e.createdByName}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-7" onClick={() => setEditFor(e)}><Pencil className="h-3 w-3" /></Button>
                      <Button size="sm" variant="ghost" className="h-7 text-melo-dark" onClick={() => remove(e.id)}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {open ? (
        <ExpenseDialog onClose={() => setOpen(false)} onSaved={(data) => { setOpen(false); save(data); }} />
      ) : null}
      {editFor ? (
        <ExpenseDialog existing={editFor} onClose={() => setEditFor(null)} onSaved={(data) => { setEditFor(null); save(data, editFor.id); }} />
      ) : null}
    </div>
  );
}

function ExpenseDialog({
  existing, onClose, onSaved,
}: {
  existing?: Expense | null;
  onClose: () => void;
  onSaved: (data: Omit<Expense, "id">) => void;
}) {
  const [description, setDescription] = useState(existing?.description ?? "");
  const [category, setCategory] = useState<Expense["category"]>(existing?.category ?? "INSUMOS");
  const [amount, setAmount] = useState(existing ? String(existing.amount) : "");
  const [date, setDate] = useState(existing ? existing.spentAt.slice(0, 10) : "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [err, setErr] = useState<string | null>(null);

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
              <Select value={category} onValueChange={(v) => setCategory(v as Expense["category"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.keys(CATEGORY_LABEL).map((c) => <SelectItem key={c} value={c}>{CATEGORY_LABEL[c]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label>Monto (COP)</Label>
              <Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1">
            <Label>Fecha</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label>Notas (opcional)</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {err ? <div className="rounded-lg bg-melo/10 p-2 text-sm text-melo-dark">{err}</div> : null}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            disabled={!description || !amount}
            onClick={() => {
              const n = Number(amount);
              if (!Number.isFinite(n) || n <= 0) { setErr("Monto inválido"); return; }
              onSaved({
                description, category, amount: Math.round(n),
                method: null, notes: notes || null,
                spentAt: date ? new Date(`${date}T12:00:00-05:00`).toISOString() : new Date().toISOString(),
                createdByName: "Propietario",
              });
            }}
            className="bg-ink hover:bg-ink/80 text-ivory"
          >
            {existing ? "Guardar cambios" : "Registrar gasto"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
