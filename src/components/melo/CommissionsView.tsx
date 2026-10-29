"use client";
// Comisiones: configuración por barbero × servicio (versionada) y comisiones generadas
// con su copia histórica (requisitos C y E).
import { useMemo, useState } from "react";
import { api, useData } from "@/lib/api";
import { cop, pct } from "@/lib/money";
import { fmtDateMedium, timeHMInBogota } from "@/lib/time";
import { SectionTitle, LoadingBlock, ErrorBlock, EmptyState, Chip, Money } from "@/components/melo/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { Percent, History, Settings2, Wand2, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type RuleRow = {
  id: string;
  barberId: string;
  serviceId: string | null;
  commissionType: "PERCENT" | "FIXED" | "MIXED";
  percent: number | null;
  fixedAmount: number | null;
  validFrom: string;
  validTo: string | null;
  note: string | null;
  current?: boolean;
};

type CommissionRow = {
  id: string;
  appointmentId: string;
  status: "PENDING_CONFIG" | "PENDING_PAYMENT" | "PAID";
  configured: boolean;
  commissionType: string | null;
  percent: number | null;
  fixedAmount: number | null;
  baseAmount: number;
  calculatedAmount: number;
  manualSet: boolean;
  manualReason: string | null;
  snapshotJson: string;
  createdAt: string;
  barber: { id: string; name: string };
  appointment: {
    code: string;
    clientName: string;
    service: { name: string };
    completedAt: string | null;
    priceSnapshot: number;
    discount: number;
    pagado: number;
    pendiente: number;
  };
  settlementItems?: Array<{ settlement: { code: string; status: string } }>;
};

export function CommissionsView({ user }: { user: { id: string; role: string; name: string } }) {
  const configQ = useData<{ barbers: Array<{ id: string; name: string }>; services: Array<{ id: string; name: string; price: number }>; current: RuleRow[]; history: RuleRow[] }>(
    "/api/commissions/config"
  );
  const [barberId, setBarberId] = useState("ALL");
  const listQ = useData<{ commissions: CommissionRow[] }>(`/api/commissions${barberId !== "ALL" ? `?barberId=${barberId}` : ""}`, [barberId]);
  const [editFor, setEditFor] = useState<{ barberId: string; barberName: string; serviceId: string | null; serviceName: string } | null>(null);
  const [manualFor, setManualFor] = useState<CommissionRow | null>(null);
  const [historyFor, setHistoryFor] = useState<{ name: string; rows: RuleRow[] } | null>(null);

  const barbers = configQ.data?.barbers ?? [];
  const services = configQ.data?.services ?? [];
  const current = configQ.data?.current ?? [];

  const ruleLabel = (r?: RuleRow | null) => {
    if (!r) return "Sin configurar";
    if (r.commissionType === "PERCENT") return `${pct(r.percent)} de la venta neta`;
    if (r.commissionType === "FIXED") return `${cop(r.fixedAmount ?? 0)} por servicio`;
    return `${pct(r.percent)} + ${cop(r.fixedAmount ?? 0)} (mixto)`;
  };

  const findRule = (bid: string, sid: string | null) =>
    current.find((r) => r.barberId === bid && (r.serviceId ?? null) === (sid ?? null)) ?? null;

  const stats = useMemo(() => {
    const list = listQ.data?.commissions ?? [];
    return {
      generadas: list.reduce((s, c) => s + c.calculatedAmount, 0),
      pendientes: list.filter((c) => c.status === "PENDING_PAYMENT").reduce((s, c) => s + c.calculatedAmount, 0),
      pagadas: list.filter((c) => c.status === "PAID").reduce((s, c) => s + c.calculatedAmount, 0),
      sinConfig: list.filter((c) => c.status === "PENDING_CONFIG").length,
    };
  }, [listQ.data]);

  return (
    <div>
      <SectionTitle
        title="Comisiones"
        sub="Configura por barbero y por servicio: porcentaje de la venta neta, valor fijo o mixto. Cada cambio crea una nueva versión; las comisiones ya generadas conservan su copia histórica."
        right={
          <div className="flex gap-2 rounded-xl bg-ivory px-4 py-2 text-sm">
            <span className="text-ink-soft">Generadas:</span><b>{cop(stats.generadas)}</b>
            <span className="text-ink-soft ml-2">Pendientes:</span><b>{cop(stats.pendientes)}</b>
            <span className="text-ink-soft ml-2">Pagadas:</span><b>{cop(stats.pagadas)}</b>
          </div>
        }
      />

      <Tabs defaultValue="config">
        <TabsList className="bg-ivory">
          <TabsTrigger value="config"><Settings2 className="mr-1 h-4 w-4" /> Configuración</TabsTrigger>
          <TabsTrigger value="generated"><Percent className="mr-1 h-4 w-4" /> Generadas</TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="mt-4">
          {configQ.loading ? <LoadingBlock /> : null}
          {configQ.error ? <ErrorBlock message={configQ.error} onRetry={configQ.reload} /> : null}
          {configQ.data ? (
            <div className="overflow-x-auto rounded-xl border border-ink/10 bg-ivory">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Barbero</TableHead>
                    <TableHead>Regla por defecto (todos sus servicios)</TableHead>
                    {services.map((s) => <TableHead key={s.id}>{s.name}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {barbers.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">{b.name}</TableCell>
                      <TableCell>
                        <RuleCell
                          label={ruleLabel(findRule(b.id, null))}
                          onClick={() => setEditFor({ barberId: b.id, barberName: b.name, serviceId: null, serviceName: "Regla por defecto" })}
                        />
                      </TableCell>
                      {services.map((s) => {
                        const specific = findRule(b.id, s.id);
                        const effective = specific ?? findRule(b.id, null);
                        return (
                          <TableCell key={s.id}>
                            <RuleCell
                              label={ruleLabel(specific)}
                              inherited={!specific && !!effective}
                              onClick={() => setEditFor({ barberId: b.id, barberName: b.name, serviceId: s.id, serviceName: s.name })}
                            />
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-3 text-sm text-ink-soft">
            <button onClick={() => setHistoryFor({ name: "Historial de reglas", rows: configQ.data?.history ?? [] })} className="inline-flex items-center gap-1 font-medium text-brass-dark hover:underline">
              <History className="h-4 w-4" /> Ver historial de versiones ({configQ.data?.history.length ?? 0})
            </button>
            <span className="text-ink-soft">· “Sin configurar (usa defecto)” significa que ese servicio hereda la regla por defecto del barbero.</span>
          </div>
        </TabsContent>

        <TabsContent value="generated" className="mt-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Select value={barberId} onValueChange={setBarberId}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos los barberos</SelectItem>
                {barbers.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {stats.sinConfig > 0 ? (
              <Chip className="border-warn/50 text-warn">{stats.sinConfig} sin configurar en su momento</Chip>
            ) : null}
          </div>
          {listQ.loading ? <LoadingBlock /> : listQ.error ? <ErrorBlock message={listQ.error} onRetry={listQ.reload} /> : null}
          {listQ.data && listQ.data.commissions.length === 0 ? (
            <EmptyState title="Sin comisiones generadas" sub="Las comisiones se crean al completar cada servicio, con copia de las condiciones vigentes." />
          ) : null}
          {listQ.data && listQ.data.commissions.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-ink/10 bg-ivory">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Completada</TableHead>
                    <TableHead>Cita</TableHead>
                    <TableHead>Barbero</TableHead>
                    <TableHead>Servicio</TableHead>
                    <TableHead className="text-right">Base (neta)</TableHead>
                    <TableHead>Regla aplicada (copia)</TableHead>
                    <TableHead className="text-right">Comisión</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listQ.data.commissions.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="text-sm whitespace-nowrap">
                        {c.appointment.completedAt ? `${fmtDateMedium(new Date(c.appointment.completedAt))} ${timeHMInBogota(new Date(c.appointment.completedAt))}` : "—"}
                      </TableCell>
                      <TableCell className="font-medium">{c.appointment.code}</TableCell>
                      <TableCell className="text-sm text-ink-soft">{c.barber?.name ?? "—"}</TableCell>
                      <TableCell className="text-sm">{c.appointment.service.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{cop(c.baseAmount)}</TableCell>
                      <TableCell className="text-sm text-ink-soft">
                        {c.configured
                          ? c.commissionType === "PERCENT" ? `${pct(c.percent)} de la venta neta`
                            : c.commissionType === "FIXED" ? `${cop(c.fixedAmount ?? 0)} fijo`
                            : `${pct(c.percent)} + ${cop(c.fixedAmount ?? 0)} (mixto)`
                          : "Sin regla al completar"}
                      </TableCell>
                      <TableCell className="text-right font-bold tabular-nums">{cop(c.calculatedAmount)}</TableCell>
                      <TableCell>
                        <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]",
                          c.status === "PAID" ? "bg-good/15 text-good border-good/40"
                            : c.status === "PENDING_CONFIG" ? "bg-warn/15 text-warn border-warn/40"
                            : "bg-brass/15 text-brass-dark border-brass/40")}>
                          {c.status === "PAID" ? "Pagada" : c.status === "PENDING_CONFIG" ? "Por definir" : "Pendiente de liquidar"}
                        </span>
                        {c.settlementItems && c.settlementItems.length > 0 ? (
                          <div className="mt-1 text-[10px] text-ink-soft">Liquidación {c.settlementItems[0].settlement.code}</div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {c.status === "PENDING_CONFIG" && user.role === "OWNER" ? (
                            <Button size="sm" variant="outline" className="h-7 border-warn/50 text-warn" onClick={() => setManualFor(c)}>
                              <Wand2 className="mr-1 h-3 w-3" /> Definir
                            </Button>
                          ) : null}
                          <ManualSnapshot commission={c} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </TabsContent>
      </Tabs>

      {editFor ? (
        <RuleDialog
          target={editFor}
          current={editFor.serviceId === null ? findRule(editFor.barberId, null) : findRule(editFor.barberId, editFor.serviceId)}
          onClose={() => setEditFor(null)}
          onSaved={() => { setEditFor(null); configQ.reload(); toast({ title: "Regla guardada", description: "La versión anterior quedó cerrada con su vigencia. Las comisiones históricas no cambian." }); }}
        />
      ) : null}

      {manualFor ? (
        <ManualDialog
          commission={manualFor}
          onClose={() => setManualFor(null)}
          onSaved={() => { setManualFor(null); listQ.reload(); toast({ title: "Comisión definida", description: "Quedó pendiente de liquidar, con motivo en auditoría." }); }}
        />
      ) : null}

      {historyFor ? (
        <Dialog open onOpenChange={(o) => (o ? undefined : historyFor(null))}>
          <DialogContent className="max-h-90 overflow-y-auto nice-scroll sm:max-w-2xl">
            <DialogHeader><DialogTitle>Historial de reglas de comisión</DialogTitle></DialogHeader>
            <p className="text-sm text-ink-soft">Cada cambio cierra la versión anterior y abre una nueva. Las comisiones usan la versión vigente en el momento de completar, nunca las futuras.</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vigente desde</TableHead>
                  <TableHead>Hasta</TableHead>
                  <TableHead>Barbero</TableHead>
                  <TableHead>Servicio</TableHead>
                  <TableHead>Regla</TableHead>
                  <TableHead>Nota</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(historyFor.rows).map((r) => (
                  <TableRow key={r.id} className={r.current ? "bg-good/5" : ""}>
                    <TableCell className="text-sm">{fmtDateMedium(new Date(r.validFrom))} {timeHMInBogota(new Date(r.validFrom))}</TableCell>
                    <TableCell className="text-sm">{r.validTo ? fmtDateMedium(new Date(r.validTo)) : "ahora (vigente)"}</TableCell>
                    <TableCell className="text-sm">{barbers.find((b) => b.id === r.barberId)?.name ?? r.barberId}</TableCell>
                    <TableCell className="text-sm">{r.serviceId === null ? "Defecto (todos)" : services.find((s) => s.id === r.serviceId)?.name ?? "?"}</TableCell>
                    <TableCell className="text-sm">
                      {r.commissionType === "PERCENT" ? `${pct(r.percent)} de la venta neta`
                        : r.commissionType === "FIXED" ? `${cop(r.fixedAmount ?? 0)} fijo`
                        : `${pct(r.percent)} + ${cop(r.fixedAmount ?? 0)} (mixto)`}
                    </TableCell>
                    <TableCell className="text-sm text-ink-soft">{r.note ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

function RuleCell({ label, inherited, onClick }: { label: string; inherited?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-lg border px-2 py-1 text-left text-xs transition hover:shadow-sm",
        inherited ? "border-dashed border-brass/50 bg-brass/5 text-brass-dark" : label === "Sin configurar" ? "border-ink/15 bg-cream text-ink-soft" : "border-ink/15 bg-cream text-ink"
      )}
    >
      {label === "Sin configurar" ? "Sin configurar" : label}
      {inherited ? <span className="mt-0.5 block text-[10px] opacity-70">hereda defecto</span> : null}
    </button>
  );
}

function RuleDialog({
  target, current, onClose, onSaved,
}: {
  target: { barberId: string; barberName: string; serviceId: string | null; serviceName: string };
  current: RuleRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [type, setType] = useState<"PERCENT" | "FIXED" | "MIXED">(current?.commissionType ?? "PERCENT");
  const [percent, setPercent] = useState(current?.percent != null ? String(current.percent) : "");
  const [fixed, setFixed] = useState(current?.fixedAmount != null ? String(current.fixedAmount) : "");
  const [note, setNote] = useState(current?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api("/api/commissions/config", {
        method: "POST",
        body: JSON.stringify({
          barberId: target.barberId,
          serviceId: target.serviceId,
          commissionType: type,
          percent: type === "FIXED" ? null : Number(percent || 0),
          fixedAmount: type === "PERCENT" ? null : Number(fixed || 0),
          note: note || null,
        }),
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  const valid =
    type === "PERCENT" ? percent !== "" && Number(percent) >= 0 && Number(percent) <= 100
    : type === "FIXED" ? fixed !== "" && Number(fixed) >= 0
    : percent !== "" && fixed !== "" && Number(percent) >= 0 && Number(percent) <= 100 && Number(fixed) >= 0;

  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Regla de comisión</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-ink-soft">{target.barberName} · {target.serviceName}{target.serviceId === null ? " (aplica a sus servicios sin regla específica)" : ""}</p>
        {current ? (
          <div className="rounded-lg bg-cream p-2 text-xs text-ink-soft">
            Vigente: {current.commissionType === "PERCENT" ? `${pct(current.percent)} de la venta neta` : current.commissionType === "FIXED" ? `${cop(current.fixedAmount ?? 0)} fijo` : `${pct(current.percent)} + ${cop(current.fixedAmount ?? 0)}`}
            . La nueva versión rige desde ahora; no modifica comisiones ya generadas.
          </div>
        ) : null}
        <div className="mt-2 grid gap-3">
          <div className="grid gap-1">
            <Label>Tipo de esquema</Label>
            <Select value={type} onValueChange={(v) => setType(v as "PERCENT" | "FIXED" | "MIXED")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="PERCENT">Porcentaje de la venta neta (precio − descuento)</SelectItem>
                <SelectItem value="FIXED">Valor fijo por servicio</SelectItem>
                <SelectItem value="MIXED">Mixto: porcentaje + valor fijo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {type !== "FIXED" ? (
            <div className="grid gap-1">
              <Label>Porcentaje (%)</Label>
              <Input type="number" min={0} max={100} step="0.5" value={percent} onChange={(e) => setPercent(e.target.value)} placeholder="Ej: 40" />
            </div>
          ) : null}
          {type !== "PERCENT" ? (
            <div className="grid gap-1">
              <Label>Valor fijo (COP)</Label>
              <Input type="number" min={0} value={fixed} onChange={(e) => setFixed(e.target.value)} placeholder="Ej: 5000" />
            </div>
          ) : null}
          <div className="grid gap-1">
            <Label>Nota (opcional)</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Motivo o contexto del cambio" />
          </div>
          {err ? <div className="rounded-lg bg-melo/10 p-2 text-sm text-melo-dark">{err}</div> : null}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={busy || !valid} onClick={save} className="bg-ink hover:bg-ink/80 text-ivory">Guardar nueva versión</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ManualDialog({ commission, onClose, onSaved }: { commission: CommissionRow; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/commissions/${commission.id}/manual`, {
        method: "POST",
        body: JSON.stringify({ amount: Number(amount), reason }),
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
        <DialogHeader><DialogTitle>Definir comisión manualmente</DialogTitle></DialogHeader>
        <p className="text-sm text-ink-soft">
          Cita {commission.appointment.code} · base {cop(commission.baseAmount)} · no había regla vigente al completar.
          El valor que definas queda pendiente de liquidar y se registra en auditoría con su motivo.
        </p>
        <div className="mt-3 grid gap-3">
          <div className="grid gap-1">
            <Label>Valor de la comisión (COP)</Label>
            <Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Ej: 12000" />
          </div>
          <div className="grid gap-1">
            <Label>Motivo (obligatorio)</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej: acuerdo verbal previo" />
          </div>
          {err ? <div className="rounded-lg bg-melo/10 p-2 text-sm text-melo-dark">{err}</div> : null}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={busy || !amount || reason.trim().length < 3} onClick={save} className="bg-ink hover:bg-ink/80 text-ivory">Definir valor</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ManualSnapshot({ commission }: { commission: CommissionRow }) {
  const [open, setOpen] = useState(false);
  let snap: Record<string, unknown> | null = null;
  try {
    snap = JSON.parse(commission.snapshotJson);
  } catch {
    snap = null;
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 text-xs text-ink-soft">
          <ChevronDown className="mr-1 h-3 w-3" /> Copia histórica
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-90 overflow-y-auto nice-scroll sm:max-w-xl">
        <DialogHeader><DialogTitle>Copia de condiciones · {commission.appointment.code}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-ink-soft">Snapshot inmutable guardado al completar el servicio. Cambios futuros de tarifas no la alteran.</p>
        {commission.manualSet ? (
          <div className="rounded-lg bg-warn/10 p-2 text-sm text-warn">Definida manualmente. Motivo: {commission.manualReason}</div>
        ) : null}
        <pre className="mt-2 max-h-80 overflow-auto rounded-xl bg-ink p-4 text-xs leading-relaxed text-cream nice-scroll">
          {snap ? JSON.stringify(snap, null, 2) : "Sin snapshot"}
        </pre>
      </DialogContent>
    </Dialog>
  );
}

/** Vista del barbero: solo sus comisiones (requisito E). */
export function MyCommissionsView({ user }: { user: { id: string; name: string; role: string } }) {
  const q = useData<{ commissions: CommissionRow[] }>("/api/commissions", []);
  const stats = useMemo(() => {
    const list = q.data?.commissions ?? [];
    return {
      total: list.reduce((s, c) => s + c.calculatedAmount, 0),
      pendientes: list.filter((c) => c.status === "PENDING_PAYMENT").reduce((s, c) => s + c.calculatedAmount, 0),
      pagadas: list.filter((c) => c.status === "PAID").reduce((s, c) => s + c.calculatedAmount, 0),
    };
  }, [q.data]);

  return (
    <div>
      <SectionTitle
        title="Mis comisiones"
        sub="Lo que has generado según las reglas vigentes al completar cada servicio. No puedes modificar las reglas: solo el propietario."
        right={
          <div className="flex gap-2 rounded-xl bg-ivory px-4 py-2 text-sm">
            <span className="text-ink-soft">Total:</span><b><Money value={stats.total} /></b>
            <span className="text-ink-soft ml-2">Pendiente:</span><b>{cop(stats.pendientes)}</b>
            <span className="text-ink-soft ml-2">Pagado:</span><b>{cop(stats.pagadas)}</b>
          </div>
        }
      />
      {q.loading ? <LoadingBlock /> : null}
      {q.error ? <ErrorBlock message={q.error} onRetry={q.reload} /> : null}
      {q.data && q.data.commissions.length === 0 ? <EmptyState title="Aún sin comisiones" sub="Completa servicios para generar comisiones con copia de las condiciones." /> : null}
      {q.data && q.data.commissions.length > 0 ? (
        <div className="grid gap-2">
          {q.data.commissions.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-ink/10 bg-ivory px-4 py-3 text-sm">
              <Percent className="h-4 w-4 text-brass-dark" />
              <span className="font-medium">{c.appointment.code}</span>
              <span className="text-ink-soft">{c.appointment.service.name} · {c.barber?.name ?? ""}</span>
              <Chip>{c.configured ? (c.commissionType === "PERCENT" ? `${pct(c.percent)}` : c.commissionType === "FIXED" ? "fijo" : "mixto") : "sin regla"}</Chip>
              <span className="ml-auto font-bold tabular-nums">{cop(c.calculatedAmount)}</span>
              <span className={cn("rounded-full border px-2 py-0.5 text-[11px]",
                c.status === "PAID" ? "bg-good/15 text-good border-good/40" : c.status === "PENDING_CONFIG" ? "bg-warn/15 text-warn border-warn/40" : "bg-brass/15 text-brass-dark border-brass/40")}>
                {c.status === "PAID" ? "pagada" : c.status === "PENDING_CONFIG" ? "por definir" : "pendiente"}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
