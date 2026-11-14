"use client";
// Comisiones: configuración versionada + generadas con copia histórica legible
// (nada de cajas negras con JSON) + exportación Excel.
import { useEffect, useMemo, useState } from "react";
import { cop, pct } from "@/lib/money";
import { fmtDateMedium, timeHMInBogota } from "@/lib/time";
import { getDB, mutateDB, audit, type SessionUser, type CommissionRule, type Commission } from "@/lib/store";
import { SectionTitle, EmptyState, Chip, Money } from "@/components/melo/ui";
import { exportCommissionsExcel } from "@/lib/excel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { Percent, History, Settings2, Wand2, FileDown } from "lucide-react";
import { cn } from "@/lib/utils";

function ruleLabel(r: { commissionType: "PERCENT" | "FIXED" | "MIXED" | null; percent: number | null; fixedAmount: number | null } | null): string {
  if (!r) return "Sin configurar";
  if (r.commissionType === "PERCENT") return `${pct(r.percent)} de la venta neta`;
  if (r.commissionType === "FIXED") return `${cop(r.fixedAmount ?? 0)} por servicio`;
  return `${pct(r.percent)} + ${cop(r.fixedAmount ?? 0)} (mixto)`;
}

function statusLabel(s: string): string {
  return s === "PAID" ? "Pagada" : s === "PENDING_CONFIG" ? "Por definir" : "Pendiente de liquidar";
}

export function CommissionsView({ user }: { user: SessionUser }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const h = () => setTick((n) => n + 1);
    window.addEventListener("melo:db-changed", h);
    return () => window.removeEventListener("melo:db-changed", h);
  }, []);

  const db = getDB();
  const isOwner = user.role === "OWNER";
  const barbers = db.barbers;
  const services = db.services;

  const [barberId, setBarberId] = useState("ALL");
  const [editFor, setEditFor] = useState<{ barberId: string; barberName: string; serviceId: string | null; serviceName: string } | null>(null);
  const [manualFor, setManualFor] = useState<Commission | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  const currentRules = useMemo(() => {
    const map = new Map<string, CommissionRule>();
    for (const r of db.commissionRules) {
      if (r.validTo) continue;
      const key = `${r.barberId}:${r.serviceId ?? "DEF"}`;
      const prev = map.get(key);
      if (!prev || r.validFrom > prev.validFrom) map.set(key, r);
    }
    return Array.from(map.values());
  }, [tick]);

  const commissions = useMemo(() => {
    const list = db.commissions.filter((c) => (barberId === "ALL" ? true : c.barberId === barberId));
    if (!isOwner) return db.commissions.filter((c) => c.barberId === user.id);
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [tick, barberId, isOwner]);

  const stats = useMemo(() => ({
    generadas: commissions.reduce((s, c) => s + c.calculatedAmount, 0),
    pendientes: commissions.filter((c) => c.status === "PENDING_PAYMENT").reduce((s, c) => s + c.calculatedAmount, 0),
    pagadas: commissions.filter((c) => c.status === "PAID").reduce((s, c) => s + c.calculatedAmount, 0),
    sinConfig: commissions.filter((c) => c.status === "PENDING_CONFIG").length,
  }), [commissions]);

  const findRule = (bid: string, sid: string | null) =>
    currentRules.find((r) => r.barberId === bid && (r.serviceId ?? null) === (sid ?? null)) ?? null;

  function saveRule(target: { barberId: string; serviceId: string | null }, type: "PERCENT" | "FIXED" | "MIXED", percent: number | null, fixed: number | null, note: string | null) {
    const now = new Date().toISOString();
    mutateDB((d) => {
      // cerrar versión vigente
      for (const r of d.commissionRules) {
        if (r.barberId === target.barberId && (r.serviceId ?? null) === (target.serviceId ?? null) && !r.validTo) {
          r.validTo = now;
        }
      }
      d.commissionRules.push({
        id: `rule-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
        barberId: target.barberId,
        serviceId: target.serviceId,
        commissionType: type,
        percent, fixedAmount: fixed,
        validFrom: now,
        validTo: null,
        note,
      });
    });
    audit("COMMISSION_RULE", target.barberId, "UPSERT_VERSION", user.name, null, { target, type, percent, fixed, note });
    setTick((n) => n + 1);
    toast({ title: "Regla guardada", description: "La versión anterior quedó cerrada. Las comisiones históricas no cambian." });
  }

  function manualSet(commissionId: string, amount: number, reason: string) {
    mutateDB((d) => {
      const c = d.commissions.find((x) => x.id === commissionId);
      if (!c || c.status !== "PENDING_CONFIG") return;
      c.calculatedAmount = Math.round(amount);
      c.manualSet = true;
      c.manualReason = reason.trim();
      c.status = "PENDING_PAYMENT";
    });
    audit("COMMISSION", commissionId, "MANUAL_SET", user.name, null, { amount, reason });
    setTick((n) => n + 1);
    toast({ title: "Comisión definida", description: "Quedó pendiente de liquidar, con motivo en auditoría." });
  }

  function downloadExcel() {
    exportCommissionsExcel(
      commissions.map((c) => {
        const appt = db.appointments.find((a) => a.id === c.appointmentId);
        const barber = db.barbers.find((b) => b.id === c.barberId);
        const settlement = db.settlements.find((s) => s.items.some((it) => it.commissionId === c.id));
        return {
          completada: c.snapshot.completedAt ? `${fmtDateMedium(new Date(c.snapshot.completedAt))} ${timeHMInBogota(new Date(c.snapshot.completedAt))}` : "—",
          cita: appt?.code ?? "—",
          barbero: barber?.name ?? "—",
          servicio: c.snapshot.serviceName,
          base: c.baseAmount,
          regla: c.configured
            ? c.commissionType === "PERCENT" ? `${pct(c.percent)} de la venta neta`
              : c.commissionType === "FIXED" ? `${cop(c.fixedAmount ?? 0)} fijo`
                : `${pct(c.percent)} + ${cop(c.fixedAmount ?? 0)} (mixto)`
            : "Sin regla al completar",
          comision: c.calculatedAmount,
          estado: statusLabel(c.status),
          liquidacion: settlement?.code ?? "",
        };
      }),
      isOwner ? "comisiones" : `comisiones-${user.name.split(" ")[0].toLowerCase()}`
    );
    toast({ title: "Excel generado" });
  }

  if (!isOwner) {
    // ---------------- VISTA BARBERO ----------------
    return (
      <div>
        <SectionTitle
          title="Mis comisiones"
          sub="Lo que has generado según las reglas vigentes al completar cada servicio. Solo el propietario puede modificar las reglas."
          right={
            <div className="flex gap-2 rounded-xl bg-ivory px-4 py-2 text-sm">
              <span className="text-ink-soft">Total:</span><b><Money value={stats.generadas} /></b>
              <span className="text-ink-soft ml-2">Pendiente:</span><b>{cop(stats.pendientes)}</b>
              <span className="text-ink-soft ml-2">Pagado:</span><b>{cop(stats.pagadas)}</b>
            </div>
          }
        />
        {commissions.length === 0 ? <EmptyState title="Aún sin comisiones" sub="Completa servicios para generar comisiones con copia de las condiciones." /> : (
          <div className="grid gap-2">
            {commissions.map((c) => {
              const appt = db.appointments.find((a) => a.id === c.appointmentId);
              return (
                <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-ink/10 bg-ivory px-4 py-3 text-sm">
                  <Percent className="h-4 w-4 text-brass-dark" />
                  <span className="font-medium">{appt?.code}</span>
                  <span className="text-ink-soft">{c.snapshot.serviceName}</span>
                  <Chip>{c.configured ? (c.commissionType === "PERCENT" ? `${pct(c.percent)}` : c.commissionType === "FIXED" ? "fijo" : "mixto") : "sin regla"}</Chip>
                  <span className="ml-auto font-bold tabular-nums">{cop(c.calculatedAmount)}</span>
                  <span className={cn("rounded-full border px-2 py-0.5 text-[11px]",
                    c.status === "PAID" ? "bg-good/15 text-good border-good/40" : c.status === "PENDING_CONFIG" ? "bg-warn/15 text-warn border-warn/40" : "bg-brass/15 text-brass-dark border-brass/40")}>
                    {statusLabel(c.status)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ---------------- VISTA PROPIETARIO ----------------
  return (
    <div>
      <SectionTitle
        title="Comisiones"
        sub="Configura por barbero y por servicio: porcentaje de la venta neta, valor fijo o mixto. Cada cambio crea una nueva versión; las comisiones ya generadas conservan su copia histórica."
        right={
          <div className="flex flex-wrap gap-2 rounded-xl bg-ivory px-4 py-2 text-sm">
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
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-ink-soft">
            <button onClick={() => setHistoryFor("all")} className="inline-flex items-center gap-1 font-medium text-brass-dark hover:underline">
              <History className="h-4 w-4" /> Ver historial de versiones ({db.commissionRules.length})
            </button>
            <span>· “Sin configurar” con borde punteado significa que ese servicio hereda la regla por defecto del barbero.</span>
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
            {stats.sinConfig > 0 ? <Chip className="border-warn/50 text-warn">{stats.sinConfig} sin configurar en su momento</Chip> : null}
            <Button variant="outline" size="sm" onClick={downloadExcel} disabled={commissions.length === 0} className="ml-auto border-good/50 text-good hover:bg-good/10">
              <FileDown className="mr-1 h-4 w-4" /> Excel de comisiones
            </Button>
          </div>
          {commissions.length === 0 ? (
            <EmptyState title="Sin comisiones generadas" sub="Las comisiones se crean al completar cada servicio, con copia de las condiciones vigentes." />
          ) : (
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
                  {commissions.map((c) => {
                    const appt = db.appointments.find((a) => a.id === c.appointmentId);
                    const barber = db.barbers.find((b) => b.id === c.barberId);
                    const settlement = db.settlements.find((s) => s.items.some((it) => it.commissionId === c.id));
                    return (
                      <TableRow key={c.id}>
                        <TableCell className="text-sm whitespace-nowrap">
                          {c.snapshot.completedAt ? `${fmtDateMedium(new Date(c.snapshot.completedAt))} ${timeHMInBogota(new Date(c.snapshot.completedAt))}` : "—"}
                        </TableCell>
                        <TableCell className="font-medium">{appt?.code ?? "—"}</TableCell>
                        <TableCell className="text-sm text-ink-soft">{barber?.name ?? "—"}</TableCell>
                        <TableCell className="text-sm">{c.snapshot.serviceName}</TableCell>
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
                            {statusLabel(c.status)}
                          </span>
                          {settlement ? <div className="mt-1 text-[10px] text-ink-soft">Liquidación {settlement.code}</div> : null}
                        </TableCell>
                        <TableCell>
                          {c.status === "PENDING_CONFIG" ? (
                            <Button size="sm" variant="outline" className="h-7 border-warn/50 text-warn" onClick={() => setManualFor(c)}>
                              <Wand2 className="mr-1 h-3 w-3" /> Definir
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {editFor ? (
        <RuleDialog
          target={editFor}
          current={editFor.serviceId === null ? findRule(editFor.barberId, null) : findRule(editFor.barberId, editFor.serviceId)}
          onClose={() => setEditFor(null)}
          onSaved={(type, percent, fixed, note) => { setEditFor(null); saveRule(editFor, type, percent, fixed, note); }}
        />
      ) : null}

      {manualFor ? (
        <ManualDialog
          commission={manualFor}
          onClose={() => setManualFor(null)}
          onSaved={(amount, reason) => { setManualFor(null); manualSet(manualFor.id, amount, reason); }}
        />
      ) : null}

      {historyFor ? (
        <Dialog open onOpenChange={(o) => (o ? undefined : setHistoryFor(null))}>
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
                {db.commissionRules.slice().sort((a, b) => b.validFrom.localeCompare(a.validFrom)).map((r) => (
                  <TableRow key={r.id} className={!r.validTo ? "bg-good/5" : ""}>
                    <TableCell className="text-sm">{fmtDateMedium(new Date(r.validFrom))} {timeHMInBogota(new Date(r.validFrom))}</TableCell>
                    <TableCell className="text-sm">{r.validTo ? fmtDateMedium(new Date(r.validTo)) : "ahora (vigente)"}</TableCell>
                    <TableCell className="text-sm">{barbers.find((b) => b.id === r.barberId)?.name ?? r.barberId}</TableCell>
                    <TableCell className="text-sm">{r.serviceId === null ? "Defecto (todos)" : services.find((s) => s.id === r.serviceId)?.name ?? "?"}</TableCell>
                    <TableCell className="text-sm">{ruleLabel(r)}</TableCell>
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
      {label}
      {inherited ? <span className="mt-0.5 block text-[10px] opacity-70">hereda defecto</span> : null}
    </button>
  );
}

function RuleDialog({
  target, current, onClose, onSaved,
}: {
  target: { barberId: string; barberName: string; serviceId: string | null; serviceName: string };
  current: CommissionRule | null;
  onClose: () => void;
  onSaved: (type: "PERCENT" | "FIXED" | "MIXED", percent: number | null, fixed: number | null, note: string | null) => void;
}) {
  const [type, setType] = useState<"PERCENT" | "FIXED" | "MIXED">(current?.commissionType ?? "PERCENT");
  const [percent, setPercent] = useState(current?.percent != null ? String(current.percent) : "");
  const [fixed, setFixed] = useState(current?.fixedAmount != null ? String(current.fixedAmount) : "");
  const [note, setNote] = useState(current?.note ?? "");
  const [err, setErr] = useState<string | null>(null);

  const valid =
    type === "PERCENT" ? percent !== "" && Number(percent) >= 0 && Number(percent) <= 100
    : type === "FIXED" ? fixed !== "" && Number(fixed) >= 0
    : percent !== "" && fixed !== "" && Number(percent) >= 0 && Number(percent) <= 100 && Number(fixed) >= 0;

  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader><DialogTitle>Regla de comisión</DialogTitle></DialogHeader>
        <p className="text-sm text-ink-soft">{target.barberName} · {target.serviceName}{target.serviceId === null ? " (aplica a sus servicios sin regla específica)" : ""}</p>
        {current ? (
          <div className="rounded-lg bg-cream p-2 text-xs text-ink-soft">
            Vigente: {ruleLabel(current)}. La nueva versión rige desde ahora; no modifica comisiones ya generadas.
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
          <Button
            disabled={!valid}
            onClick={() => {
              setErr(null);
              if (type === "PERCENT" && (Number(percent) < 0 || Number(percent) > 100)) { setErr("El porcentaje debe estar entre 0 y 100"); return; }
              onSaved(type, type === "FIXED" ? null : Number(percent || 0), type === "PERCENT" ? null : Number(fixed || 0), note || null);
            }}
            className="bg-ink hover:bg-ink/80 text-ivory"
          >
            Guardar nueva versión
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ManualDialog({ commission, onClose, onSaved }: { commission: Commission; onClose: () => void; onSaved: (amount: number, reason: string) => void }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader><DialogTitle>Definir comisión manualmente</DialogTitle></DialogHeader>
        <p className="text-sm text-ink-soft">
          Base {cop(commission.baseAmount)} · no había regla vigente al completar.
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
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={!amount || reason.trim().length < 3} onClick={() => onSaved(Number(amount), reason)} className="bg-ink hover:bg-ink/80 text-ivory">Definir valor</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Historial completo de comisiones pagadas de un barbero (requisito 8). */
export function BarberCommissionHistory({ barberId, onClose }: { barberId: string; onClose: () => void }) {
  const db = getDB();
  const barber = db.barbers.find((b) => b.id === barberId);
  const commissions = db.commissions
    .filter((c) => c.barberId === barberId && c.status === "PAID")
    .sort((a, b) => b.snapshot.completedAt.localeCompare(a.snapshot.completedAt));
  const total = commissions.reduce((s, c) => s + c.calculatedAmount, 0);

  function downloadExcel() {
    exportCommissionsExcel(
      commissions.map((c) => {
        const appt = db.appointments.find((a) => a.id === c.appointmentId);
        const settlement = db.settlements.find((s) => s.items.some((it) => it.commissionId === c.id));
        return {
          completada: `${fmtDateMedium(new Date(c.snapshot.completedAt))} ${timeHMInBogota(new Date(c.snapshot.completedAt))}`,
          cita: appt?.code ?? "—",
          barbero: barber?.name ?? "—",
          servicio: c.snapshot.serviceName,
          base: c.baseAmount,
          regla: c.configured ? (c.commissionType === "PERCENT" ? `${pct(c.percent)} neta` : c.commissionType === "FIXED" ? "fijo" : "mixto") : "manual",
          comision: c.calculatedAmount,
          estado: "Pagada",
          liquidacion: settlement?.code ?? "",
        };
      }),
      `comisiones-pagadas-${barber?.name.split(" ")[0].toLowerCase() ?? "barbero"}`
    );
  }

  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="max-h-92 overflow-y-auto nice-scroll sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Historial de comisiones pagadas · {barber?.name}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="rounded-xl bg-ivory px-4 py-2 text-sm">
            <span className="text-ink-soft">Total pagado históricamente:</span> <b>{cop(total)}</b>
            <span className="ml-3 text-ink-soft">Comisiones:</span> <b>{commissions.length}</b>
          </div>
          <Button size="sm" variant="outline" onClick={downloadExcel} disabled={commissions.length === 0} className="border-good/50 text-good hover:bg-good/10">
            <FileDown className="mr-1 h-4 w-4" /> Excel
          </Button>
        </div>
        {commissions.length === 0 ? (
          <EmptyState title="Sin comisiones pagadas" sub="Cuando pagues liquidaciones de este barbero aparecerán aquí." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Completada</TableHead>
                <TableHead>Cita</TableHead>
                <TableHead>Servicio</TableHead>
                <TableHead className="text-right">Base</TableHead>
                <TableHead>Regla (copia)</TableHead>
                <TableHead className="text-right">Comisión</TableHead>
                <TableHead>Liquidación</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {commissions.map((c) => {
                const appt = db.appointments.find((a) => a.id === c.appointmentId);
                const settlement = db.settlements.find((s) => s.items.some((it) => it.commissionId === c.id));
                return (
                  <TableRow key={c.id}>
                    <TableCell className="text-sm whitespace-nowrap">{fmtDateMedium(new Date(c.snapshot.completedAt))}</TableCell>
                    <TableCell className="font-medium">{appt?.code ?? "—"}</TableCell>
                    <TableCell className="text-sm">{c.snapshot.serviceName}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm">{cop(c.baseAmount)}</TableCell>
                    <TableCell className="text-xs text-ink-soft">
                      {c.manualSet ? `Manual: ${c.manualReason}` : c.configured ? ruleLabel(c) : "Sin regla"}
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums">{cop(c.calculatedAmount)}</TableCell>
                    <TableCell className="text-xs">{settlement?.code ?? "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}
