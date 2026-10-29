"use client";
// Catálogo de servicios y Equipo (barberos, permisos, autorizaciones, disponibilidad).
import { useEffect, useMemo, useState } from "react";
import { api, useData } from "@/lib/api";
import { cop } from "@/lib/money";
import { DIAS, fmtDateMedium, timeHMInBogota } from "@/lib/time";
import { SectionTitle, LoadingBlock, ErrorBlock, EmptyState, Chip } from "@/components/melo/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { Scissors, Plus, Pencil, Clock, Users, ShieldCheck, KeyRound, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SessionUser } from "@/components/melo/LoginView";

type ServiceRow = { id: string; name: string; description: string | null; price: number; durationMin: number; active: boolean; sortOrder: number };

export function CatalogView() {
  const q = useData<{ services: ServiceRow[] }>("/api/services");
  const [open, setOpen] = useState(false);
  const [editFor, setEditFor] = useState<ServiceRow | null>(null);

  return (
    <div>
      <SectionTitle
        title="Catálogo de servicios"
        sub="Precios y duraciones de demostración: edítalos a tu realidad. Cambiar un precio NO altera el precio copiado en citas históricas ni las comisiones ya generadas."
        right={<Button onClick={() => setOpen(true)} className="bg-melo hover:bg-melo-dark text-ivory"><Plus className="mr-1 h-4 w-4" /> Nuevo servicio</Button>}
      />
      {q.loading ? <LoadingBlock /> : null}
      {q.error ? <ErrorBlock message={q.error} onRetry={q.reload} /> : null}
      {q.data && q.data.services.length === 0 ? <EmptyState icon={<Scissors className="h-8 w-8" />} title="Catálogo vacío" /> : null}
      {q.data && q.data.services.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-ink/10 bg-ivory">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Servicio</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead className="text-right">Precio</TableHead>
                <TableHead className="text-right">Duración</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.services.map((s) => (
                <TableRow key={s.id} className={cn(!s.active && "opacity-60")}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="max-w-72 text-sm text-ink-soft">{s.description ?? "—"}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{cop(s.price)}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.durationMin} min</TableCell>
                  <TableCell>
                    <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", s.active ? "bg-good/15 text-good border-good/40" : "bg-ink/10 text-ink-soft border-ink/30")}>
                      {s.active ? "activo" : "inactivo"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-7" onClick={() => setEditFor(s)}><Pencil className="h-3 w-3" /></Button>
                      <Button
                        size="sm" variant="ghost" className="h-7"
                        onClick={async () => {
                          try {
                            await api(`/api/services/${s.id}`, { method: "PATCH", body: JSON.stringify({ active: !s.active }) });
                            toast({ title: s.active ? "Servicio desactivado" : "Servicio activado" });
                            q.reload();
                          } catch (e) {
                            toast({ title: "Error", description: e instanceof Error ? e.message : "", variant: "destructive" });
                          }
                        }}
                      >
                        {s.active ? "Desactivar" : "Activar"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {open ? <ServiceDialog onClose={() => setOpen(false)} onSaved={() => { setOpen(false); q.reload(); toast({ title: "Servicio creado" }); }} /> : null}
      {editFor ? <ServiceDialog existing={editFor} onClose={() => setEditFor(null)} onSaved={() => { setEditFor(null); q.reload(); toast({ title: "Servicio actualizado" }); }} /> : null}
    </div>
  );
}

function ServiceDialog({ existing, onClose, onSaved }: { existing?: ServiceRow | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [price, setPrice] = useState(existing ? String(existing.price) : "");
  const [durationMin, setDurationMin] = useState(existing ? String(existing.durationMin) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api(existing ? `/api/services/${existing.id}` : "/api/services", {
        method: existing ? "PATCH" : "POST",
        body: JSON.stringify({ name, description: description || null, price: Number(price), durationMin: Number(durationMin) }),
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
        <DialogHeader><DialogTitle>{existing ? "Editar servicio" : "Nuevo servicio"}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1"><Label>Nombre</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Corte + Barba" /></div>
          <div className="grid gap-1"><Label>Descripción</Label><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1"><Label>Precio (COP)</Label><Input type="number" min={1} value={price} onChange={(e) => setPrice(e.target.value)} /></div>
            <div className="grid gap-1"><Label>Duración (min)</Label><Input type="number" min={10} max={300} value={durationMin} onChange={(e) => setDurationMin(e.target.value)} /></div>
          </div>
          {err ? <div className="rounded-lg bg-melo/10 p-2 text-sm text-melo-dark">{err}</div> : null}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={busy || !name || !price || !durationMin} onClick={save} className="bg-melo hover:bg-melo-dark text-ivory">Guardar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================ EQUIPO
type WorkerRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  active: boolean;
  permissions: Record<string, boolean>;
  notifyInternal: boolean;
  notifyWhatsapp: boolean;
  barberServices: Array<{ serviceId: string; authorized: boolean; service: { id: string; name: string; active: boolean; price: number } }>;
  availability: Array<{ dayOfWeek: number; startTime: string; endTime: string; active: boolean }>;
};

const PERM_LABELS: Record<string, string> = {
  "finance.viewOthers": "Ver finanzas de otros barberos",
  "schedule.manageOwn": "Editar su propia disponibilidad",
  "settlements.approveOwn": "Aprobar sus propias liquidaciones",
};

export function WorkersView({ user }: { user: SessionUser }) {
  const q = useData<{ workers: WorkerRow[] }>("/api/workers");
  const [tab, setTab] = useState<string>("");
  const [newOpen, setNewOpen] = useState(false);
  const workers = q.data?.workers ?? [];
  const active = tab || workers[0]?.id || "";

  return (
    <div>
      <SectionTitle
        title="Equipo"
        sub="Barberos, permisos excepcionales (validados en servidor), servicios autorizados y disponibilidad semanal."
        right={<Button onClick={() => setNewOpen(true)} className="bg-melo hover:bg-melo-dark text-ivory"><Plus className="mr-1 h-4 w-4" /> Nuevo barbero</Button>}
      />
      {q.loading ? <LoadingBlock /> : null}
      {q.error ? <ErrorBlock message={q.error} onRetry={q.reload} /> : null}
      {workers.length === 0 && q.data ? <EmptyState icon={<Users className="h-8 w-8" />} title="Sin barberos" sub="Crea el primero." /> : null}

      {workers.length > 0 ? (
        <Tabs value={active} onValueChange={setTab}>
          <TabsList className="flex-wrap bg-ivory">
            {workers.map((w) => (
              <TabsTrigger key={w.id} value={w.id}>
                {w.name}
                {!w.active ? <span className="ml-1 text-[10px] text-melo-dark">(inactivo)</span> : null}
              </TabsTrigger>
            ))}
          </TabsList>
          {workers.map((w) => (
            <TabsContent key={w.id} value={w.id} className="mt-4">
              <WorkerTabs workerId={w.id} onChanged={() => q.reload()} />
            </TabsContent>
          ))}
        </Tabs>
      ) : null}

      {newOpen ? <NewWorkerDialog onClose={() => setNewOpen(false)} onCreated={() => { setNewOpen(false); q.reload(); toast({ title: "Barbero creado", description: "Compártele sus credenciales con seguridad." }); }} /> : null}
    </div>
  );
}

function WorkerTabs({ workerId, onChanged }: { workerId: string; onChanged: () => void }) {
  const profileQ = useData<{ workers: WorkerRow[]; permissionKeys: string[] }>("/api/workers");
  const worker = profileQ.data?.workers.find((w) => w.id === workerId) ?? null;
  const servicesQ = useData<{ services: ServiceRow[] }>("/api/services");
  const [tab, setTab] = useState("perfil");
  if (!worker) return <LoadingBlock />;

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="bg-ivory">
        <TabsTrigger value="perfil">Perfil y permisos</TabsTrigger>
        <TabsTrigger value="servicios">Servicios autorizados</TabsTrigger>
        <TabsTrigger value="disponibilidad">Disponibilidad</TabsTrigger>
      </TabsList>
      <TabsContent value="perfil" className="mt-4"><WorkerProfile worker={worker} onChanged={onChanged} /></TabsContent>
      <TabsContent value="servicios" className="mt-4"><WorkerServices worker={worker} services={servicesQ.data?.services ?? []} onChanged={onChanged} /></TabsContent>
      <TabsContent value="disponibilidad" className="mt-4"><AvailabilityEditor barberId={worker.id} canEdit note="El propietario siempre puede editar la disponibilidad." /></TabsContent>
    </Tabs>
  );
}

function WorkerProfile({ worker, onChanged }: { worker: WorkerRow; onChanged: () => void }) {
  const [name, setName] = useState(worker.name);
  const [phone, setPhone] = useState(worker.phone ?? "");
  const [active, setActive] = useState(worker.active);
  const [password, setPassword] = useState("");
  const [perms, setPerms] = useState<Record<string, boolean>>(worker.permissions ?? {});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/workers/${worker.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name, phone: phone || null, active,
          password: password || undefined,
          permissions: perms,
        }),
      });
      toast({ title: "Perfil actualizado", description: "Los permisos se validan en servidor en cada operación." });
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-2xl border border-ink/10 bg-ivory p-5">
        <div className="mb-3 flex items-center gap-2 font-display text-lg font-bold"><ShieldCheck className="h-5 w-5 text-brass-dark" /> Perfil</div>
        <div className="grid gap-3">
          <div className="grid gap-1"><Label>Nombre</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="grid gap-1"><Label>Correo (no editable)</Label><Input value={worker.email} disabled /></div>
          <div className="grid gap-1"><Label>Teléfono</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+57 …" /></div>
          <div className="grid gap-1"><Label>Nueva contraseña (opcional)</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" /></div>
          <label className="flex items-center gap-2 text-sm"><Switch checked={active} onCheckedChange={setActive} /> Usuario activo</label>
        </div>
      </div>

      <div className="rounded-2xl border border-ink/10 bg-ivory p-5">
        <div className="mb-1 flex items-center gap-2 font-display text-lg font-bold"><KeyRound className="h-5 w-5 text-brass-dark" /> Permisos excepcionales</div>
        <p className="mb-3 text-xs text-ink-soft">Por defecto los barberos NO pueden: ver finanzas ajenas, editar sus comisiones, aprobar sus liquidaciones ni cambiar la configuración general. Aquí puedes conceder excepciones; el servidor las valida en cada petición.</p>
        <div className="grid gap-3">
          {Object.entries(PERM_LABELS).map(([k, label]) => (
            <label key={k} className="flex items-start gap-3 rounded-xl border border-ink/10 bg-cream p-3">
              <Checkbox
                checked={!!perms[k]}
                onCheckedChange={(c) => setPerms((p) => ({ ...p, [k]: !!c }))}
              />
              <span className="text-sm">{label}</span>
            </label>
          ))}
        </div>
        {err ? <div className="mt-3 rounded-lg bg-melo/10 p-2 text-sm text-melo-dark">{err}</div> : null}
        <Button disabled={busy} onClick={save} className="mt-4 w-full bg-ink hover:bg-ink/80 text-ivory">Guardar cambios</Button>
      </div>
    </div>
  );
}

function WorkerServices({ worker, services, onChanged }: { worker: WorkerRow; services: ServiceRow[]; onChanged: () => void }) {
  const initial = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const bs of worker.barberServices) map.set(bs.serviceId, bs.authorized);
    return map;
  }, [worker]);
  const [auth, setAuth] = useState<Map<string, boolean>>(initial);
  const [busy, setBusy] = useState(false);

  useEffect(() => setAuth(initial), [initial]);

  async function save() {
    setBusy(true);
    try {
      await api(`/api/workers/${worker.id}/services`, {
        method: "PUT",
        body: JSON.stringify({ authorizations: services.map((s) => ({ serviceId: s.id, authorized: !!auth.get(s.id) })) }),
      });
      toast({ title: "Autorizaciones guardadas", description: "Aplican para reservas web y citas manuales." });
      onChanged();
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-ink/10 bg-ivory p-5">
      <p className="mb-4 text-sm text-ink-soft">Define qué servicios puede ofrecer. Un servicio sin autorización no aparece en sus horarios y no puede completarse.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {services.map((s) => (
          <label key={s.id} className="flex items-center gap-3 rounded-xl border border-ink/10 bg-cream p-3 text-sm">
            <Checkbox
              checked={!!auth.get(s.id)}
              onCheckedChange={(c) => setAuth((m) => new Map(m).set(s.id, !!c))}
            />
            <span className="font-medium">{s.name}</span>
            <span className="ml-auto text-ink-soft tabular-nums">{cop(s.price)}</span>
          </label>
        ))}
      </div>
      <Button disabled={busy} onClick={save} className="mt-4 bg-ink hover:bg-ink/80 text-ivory">Guardar autorizaciones</Button>
    </div>
  );
}

function NewWorkerDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setErr(null);
    try {
      await api("/api/workers", { method: "POST", body: JSON.stringify({ name, email, phone: phone || null, password }) });
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
        <DialogHeader><DialogTitle>Nuevo barbero</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1"><Label>Nombre</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="grid gap-1"><Label>Correo</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="grid gap-1"><Label>Teléfono (opcional)</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          <div className="grid gap-1"><Label>Contraseña inicial</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          {err ? <div className="rounded-lg bg-melo/10 p-2 text-sm text-melo-dark">{err}</div> : null}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={busy || !name || !email || password.length < 6} onClick={create} className="bg-melo hover:bg-melo-dark text-ivory">Crear barbero</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================ DISPONIBILIDAD (editor compartido)
type AvailRow = { dayOfWeek: number; startTime: string; endTime: string; active: boolean };

export function AvailabilityEditor({ barberId, canEdit, note }: { barberId: string; canEdit: boolean; note?: string }) {
  const q = useData<{ availability: AvailRow[]; canEdit: boolean }>(`/api/workers/${barberId}/availability`);
  const [rows, setRows] = useState<Array<{ dayOfWeek: number; startTime: string; endTime: string }>>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (q.data) {
      setRows(q.data.availability.map((a) => ({ dayOfWeek: a.dayOfWeek, startTime: a.startTime, endTime: a.endTime })));
    }
  }, [q.data]);

  const editable = canEdit && (q.data?.canEdit ?? canEdit);

  function addWindow(day: number) {
    setRows((r) => [...r, { dayOfWeek: day, startTime: "10:00", endTime: "12:00" }]);
  }
  function removeRow(i: number) {
    setRows((r) => r.filter((_, idx) => idx !== i));
  }
  function update(i: number, patch: Partial<{ dayOfWeek: number; startTime: string; endTime: string }>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  async function save() {
    setBusy(true);
    try {
      await api(`/api/workers/${barberId}/availability`, { method: "PUT", body: JSON.stringify({ windows: rows }) });
      toast({ title: "Disponibilidad guardada", description: "Los nuevos horarios aplican para futuras reservas." });
      q.reload();
    } catch (e) {
      toast({ title: "No se pudo guardar", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  if (q.loading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock message={q.error} onRetry={q.reload} />;

  return (
    <div className="rounded-2xl border border-ink/10 bg-ivory p-5">
      <div className="mb-1 flex items-center gap-2 font-display text-lg font-bold"><CalendarDays className="h-5 w-5 text-brass-dark" /> Disponibilidad semanal</div>
      <p className="mb-4 text-xs text-ink-soft">{note ?? ""} Las ventanas definen dónde pueden caer las citas; los solapamientos se revisan siempre en el servidor.</p>
      {!editable ? (
        <div className="rounded-xl border border-dashed border-ink/15 bg-cream px-4 py-6 text-center text-sm text-ink-soft">
          Solo lectura. {` `}
          {canEdit ? "Se requiere el permiso «Editar su propia disponibilidad» (concedido por el propietario)." : "El propietario la administra."}
        </div>
      ) : (
        <>
          <div className="grid gap-3">
            {rows.length === 0 ? <div className="rounded-xl border border-dashed border-ink/15 px-4 py-6 text-center text-sm text-ink-soft">Sin ventanas: el barbero no recibe citas.</div> : null}
            {rows.map((r, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2 rounded-xl border border-ink/10 bg-cream p-3">
                <div className="grid gap-1">
                  <Label className="text-xs">Día</Label>
                  <Select value={String(r.dayOfWeek)} onValueChange={(v) => update(i, { dayOfWeek: Number(v) })}>
                    <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DIAS.map((d, idx) => <SelectItem key={idx} value={String(idx)}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1">
                  <Label className="text-xs">Desde</Label>
                  <Input type="time" value={r.startTime} onChange={(e) => update(i, { startTime: e.target.value })} className="w-28" />
                </div>
                <div className="grid gap-1">
                  <Label className="text-xs">Hasta</Label>
                  <Input type="time" value={r.endTime} onChange={(e) => update(i, { endTime: e.target.value })} className="w-28" />
                </div>
                <Button variant="ghost" size="icon" className="text-melo-dark" onClick={() => removeRow(i)} aria-label="Quitar"><Pencil className="hidden" /><span className="text-lg leading-none">×</span></Button>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => addWindow(2)} className="border-brass/50 text-brass-dark hover:bg-brass/10"><Plus className="mr-1 h-4 w-4" /> Agregar ventana</Button>
            <Button disabled={busy} onClick={save} className="bg-ink hover:bg-ink/80 text-ivory">Guardar disponibilidad</Button>
          </div>
        </>
      )}
    </div>
  );
}

/** Vista del barbero para su propia disponibilidad. */
export function MyAvailabilityView({ user }: { user: SessionUser }) {
  return (
    <div>
      <SectionTitle
        title="Mi disponibilidad"
        sub="Consulta tu horario semanal. Para editarlo necesitas el permiso excepcional del propietario (Equipo → Perfil y permisos)."
      />
      <AvailabilityEditor barberId={user.id} canEdit={false} note="El propietario define tus ventanas; puedes solicitarle el permiso de edición." />
    </div>
  );
}

/** Servicios autorizados del barbero (solo lectura). */
export function MyServicesView({ user }: { user: SessionUser }) {
  const q = useData<{ authorizations: Array<{ serviceId: string; authorized: boolean; service: { id: string; name: string; active: boolean; price: number } }> }>(
    `/api/workers/${user.id}/services`
  );
  return (
    <div>
      <SectionTitle title="Mis servicios autorizados" sub="Qué puedes ofrecer según el propietario. Si falta alguno, pídeselo desde Equipo." />
      {q.loading ? <LoadingBlock /> : null}
      {q.error ? <ErrorBlock message={q.error} onRetry={q.reload} /> : null}
      {q.data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {q.data.authorizations.map((a) => (
            <div key={a.serviceId} className={cn("rounded-2xl border p-4", a.authorized ? "border-good/40 bg-good/5" : "border-ink/10 bg-cream opacity-60")}>
              <div className="flex items-center justify-between">
                <span className="font-semibold">{a.service.name}</span>
                <Chip className={a.authorized ? "border-good/40 text-good" : ""}>{a.authorized ? "autorizado" : "no autorizado"}</Chip>
              </div>
              <div className="mt-1 text-sm text-ink-soft">{cop(a.service.price)} · {a.service.active ? "servicio activo" : "servicio inactivo"}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Historial de modificaciones (auditoría) — propietario. */
export function AuditView() {
  const [entity, setEntity] = useState("");
  const q = useData<{ logs: Array<{ id: string; entity: string; entityId: string; action: string; beforeJson: string | null; afterJson: string | null; userName: string | null; createdAt: string }> }>(
    `/api/audit${entity ? `?entity=${entity}` : ""}`,
    [entity]
  );
  const [openFor, setOpenFor] = useState<{ title: string; before: string; after: string } | null>(null);

  const entities = ["", "APPOINTMENT", "PAYMENT", "COMMISSION", "COMMISSION_RULE", "SETTLEMENT", "ADJUSTMENT", "EXPENSE", "SERVICE", "USER", "BARBER_SERVICE", "AVAILABILITY"];

  return (
    <div>
      <SectionTitle title="Historial de modificaciones" sub="Cada cambio relevante queda con su antes/después y autor. Nada se modifica en silencio." />
      <div className="mb-3">
        <Select value={entity || "ALL"} onValueChange={(v) => setEntity(v === "ALL" ? "" : v)}>
          <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Todas las entidades</SelectItem>
            {entities.slice(1).map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {q.loading ? <LoadingBlock /> : null}
      {q.error ? <ErrorBlock message={q.error} onRetry={q.reload} /> : null}
      {q.data && q.data.logs.length === 0 ? <EmptyState title="Sin registros" /> : null}
      {q.data && q.data.logs.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-ink/10 bg-ivory">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Entidad</TableHead>
                <TableHead>Acción</TableHead>
                <TableHead>Autor</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.logs.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="whitespace-nowrap text-sm">{fmtDateMedium(new Date(l.createdAt))} {timeHMInBogota(new Date(l.createdAt))}</TableCell>
                  <TableCell><Chip>{l.entity}</Chip></TableCell>
                  <TableCell className="text-sm font-medium">{l.action}</TableCell>
                  <TableCell className="text-sm text-ink-soft">{l.userName ?? "Sistema"}</TableCell>
                  <TableCell>
                    <Button
                      size="sm" variant="ghost" className="h-7 text-xs"
                      onClick={() =>
                        setOpenFor({
                          title: `${l.entity} · ${l.action}`,
                          before: l.beforeJson ? JSON.stringify(JSON.parse(l.beforeJson), null, 2) : "—",
                          after: l.afterJson ? JSON.stringify(JSON.parse(l.afterJson), null, 2) : "—",
                        })
                      }
                    >
                      Ver cambios
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {openFor ? (
        <Dialog open onOpenChange={(o) => (o ? undefined : setOpenFor(null))}>
          <DialogContent className="max-h-90 overflow-y-auto nice-scroll sm:max-w-3xl">
            <DialogHeader><DialogTitle>{openFor.title}</DialogTitle></DialogHeader>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="mb-1 text-xs font-semibold uppercase text-melo-dark">Antes</div>
                <pre className="max-h-80 overflow-auto rounded-xl bg-ink p-3 text-xs text-cream nice-scroll">{openFor.before}</pre>
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold uppercase text-good">Después</div>
                <pre className="max-h-80 overflow-auto rounded-xl bg-ink p-3 text-xs text-cream nice-scroll">{openFor.after}</pre>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
