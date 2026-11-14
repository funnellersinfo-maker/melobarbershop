"use client";
// Catálogo de servicios, Equipo (perfiles con foto, códigos, permisos) y auditoría.
import { useEffect, useMemo, useState } from "react";
import { cop } from "@/lib/money";
import { DIAS, fmtDateMedium, timeHMInBogota } from "@/lib/time";
import {
  getDB, mutateDB, audit, cuid, barberAccessCode,
  type SessionUser, type Service, type Barber, type Availability,
} from "@/lib/store";
import { SectionTitle, EmptyState, Chip } from "@/components/melo/ui";
import { BarberCommissionHistory } from "@/components/melo/CommissionsView";
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
import { Scissors, Plus, Pencil, Clock, Users, KeyRound, CalendarDays, History, Camera, Copy, Star, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { LEVELS, barberLevel } from "@/components/melo/Dashboards";

// ---------- subir imagen a dataURL ----------
function fileToDataURL(file: File, maxSize = 900): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("sin canvas")); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = () => reject(new Error("imagen inválida"));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error("no se pudo leer"));
    reader.readAsDataURL(file);
  });
}

export function CatalogView() {
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState(false);
  const [editFor, setEditFor] = useState<Service | null>(null);

  useEffect(() => {
    const h = () => setTick((n) => n + 1);
    window.addEventListener("melo:db-changed", h);
    return () => window.removeEventListener("melo:db-changed", h);
  }, []);

  const db = getDB();
  const services = db.services.slice().sort((a, b) => a.sortOrder - b.sortOrder);

  function saveService(data: Omit<Service, "id">, existingId?: string) {
    mutateDB((d) => {
      if (existingId) {
        const idx = d.services.findIndex((s) => s.id === existingId);
        if (idx >= 0) d.services[idx] = { ...d.services[idx], ...data };
      } else {
        d.services.push({ ...data, id: cuid("svc") });
      }
    });
    audit("SERVICE", existingId ?? "new", existingId ? "UPDATE" : "CREATE", "Propietario", null, data);
    setTick((n) => n + 1);
    toast({ title: existingId ? "Servicio actualizado" : "Servicio creado" });
  }

  return (
    <div>
      <SectionTitle
        title="Catálogo de servicios"
        sub="Precios y duraciones. Cambiar un precio NO altera el precio copiado en citas históricas ni las comisiones ya generadas."
        right={<Button onClick={() => setOpen(true)} className="bg-melo hover:bg-melo-dark text-ivory"><Plus className="mr-1 h-4 w-4" /> Nuevo servicio</Button>}
      />
      {services.length === 0 ? <EmptyState icon={<Scissors className="h-8 w-8" />} title="Catálogo vacío" /> : (
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
              {services.map((s) => (
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
                        onClick={() => {
                          saveService({ ...s, active: !s.active }, s.id);
                          toast({ title: s.active ? "Servicio desactivado" : "Servicio activado" });
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
      )}

      {open ? <ServiceDialog onClose={() => setOpen(false)} onSaved={(d) => { setOpen(false); saveService(d); }} /> : null}
      {editFor ? <ServiceDialog existing={editFor} onClose={() => setEditFor(null)} onSaved={(d) => { setEditFor(null); saveService(d, editFor.id); }} /> : null}
    </div>
  );
}

function ServiceDialog({ existing, onClose, onSaved }: { existing?: Service | null; onClose: () => void; onSaved: (d: Omit<Service, "id">) => void }) {
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [price, setPrice] = useState(existing ? String(existing.price) : "");
  const [durationMin, setDurationMin] = useState(existing ? String(existing.durationMin) : "");
  const [err, setErr] = useState<string | null>(null);

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
          <Button
            disabled={!name || !price || !durationMin}
            onClick={() => {
              const p = Number(price), dur = Number(durationMin);
              if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(dur) || dur < 5) { setErr("Valores inválidos"); return; }
              onSaved({
                name, description: description || null, price: Math.round(p),
                durationMin: Math.round(dur), active: existing?.active ?? true,
                sortOrder: existing?.sortOrder ?? (getDB().services.length + 1),
              } as Omit<Service, "id">);
            }}
            className="bg-melo hover:bg-melo-dark text-ivory"
          >
            Guardar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================ EQUIPO
export const PERM_LABELS: Record<string, string> = {
  "payments.register": "Registrar pagos de sus citas",
  "commissions.view": "Ver sus comisiones",
  "settlements.view": "Ver sus liquidaciones",
  "profile.edit": "Editar su perfil y publicar trabajos",
  "schedule.manageOwn": "Editar su propia disponibilidad",
  "settlements.approveOwn": "Aprobar sus propias liquidaciones",
  "finance.viewOthers": "Ver finanzas de otros barberos",
};

export function WorkersView({ user }: { user: SessionUser }) {
  const [tick, setTick] = useState(0);
  const [tab, setTab] = useState<string>("");
  const [newOpen, setNewOpen] = useState(false);
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  useEffect(() => {
    const h = () => setTick((n) => n + 1);
    window.addEventListener("melo:db-changed", h);
    return () => window.removeEventListener("melo:db-changed", h);
  }, []);

  const db = getDB();
  const workers = db.barbers;
  const active = tab || workers[0]?.id || "";

  return (
    <div>
      <SectionTitle
        title="Equipo"
        sub="Barberos, códigos de acceso, permisos (los controlas tú), servicios autorizados y disponibilidad semanal."
        right={<Button onClick={() => setNewOpen(true)} className="bg-melo hover:bg-melo-dark text-ivory"><Plus className="mr-1 h-4 w-4" /> Nuevo barbero</Button>}
      />
      {workers.length === 0 ? <EmptyState icon={<Users className="h-8 w-8" />} title="Sin barberos" sub="Crea el primero." /> : null}

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
              <WorkerPanel worker={w} onChanged={() => setTick((n) => n + 1)} onHistory={() => setHistoryFor(w.id)} />
            </TabsContent>
          ))}
        </Tabs>
      ) : null}

      {newOpen ? (
        <NewWorkerDialog
          onClose={() => setNewOpen(false)}
          onCreated={(name, code) => {
            setNewOpen(false);
            setTick((n) => n + 1);
            toast({ title: "Barbero creado", description: `Su código de acceso es ${code}. Compárteselo con seguridad.` });
          }}
        />
      ) : null}

      {historyFor ? <BarberCommissionHistory barberId={historyFor} onClose={() => setHistoryFor(null)} /> : null}
    </div>
  );
}

function WorkerPanel({ worker, onChanged, onHistory }: { worker: Barber; onChanged: () => void; onHistory: () => void }) {
  const db = getDB();
  const services = db.services.slice().sort((a, b) => a.sortOrder - b.sortOrder);
  const [tab, setTab] = useState("perfil");

  // stats del barbero
  const commissions = db.commissions.filter((c) => c.barberId === worker.id);
  const pagadas = commissions.filter((c) => c.status === "PAID").reduce((s, c) => s + c.calculatedAmount, 0);
  const pendientes = commissions.filter((c) => c.status === "PENDING_PAYMENT").reduce((s, c) => s + c.calculatedAmount, 0);
  const done = db.appointments.filter((a) => a.barberId === worker.id && a.status === "COMPLETED").length;
  const reviews = db.comments.filter((c) => c.barberId === worker.id && c.postId === null && !c.hidden && c.rating);
  const avg = reviews.length ? Math.round((reviews.reduce((s, c) => s + (c.rating ?? 0), 0) / reviews.length) * 10) / 10 : 0;
  const lvl = barberLevel(done);

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="bg-ivory">
        <TabsTrigger value="perfil">Perfil y permisos</TabsTrigger>
        <TabsTrigger value="servicios">Servicios autorizados</TabsTrigger>
        <TabsTrigger value="disponibilidad">Disponibilidad</TabsTrigger>
      </TabsList>

      <TabsContent value="perfil" className="mt-4">
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-good/40 bg-good/5 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Comisiones pagadas</div>
            <div className="mt-1 font-display text-2xl font-bold">{cop(pagadas)}</div>
            <button onClick={onHistory} className="mt-1 text-xs font-medium text-brass-dark hover:underline">Ver historial completo</button>
          </div>
          <div className="rounded-xl border border-warn/40 bg-warn/5 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Por liquidar</div>
            <div className="mt-1 font-display text-2xl font-bold">{cop(pendientes)}</div>
          </div>
          <div className="rounded-xl border border-brass/40 bg-brass/5 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Nivel / reseñas</div>
            <div className="mt-1 font-display text-2xl font-bold">{lvl.current.icon} {lvl.current.name}</div>
            <div className="text-xs text-ink-soft"><Star className="mr-0.5 inline h-3 w-3 fill-brass" />{avg || "—"} · {done} servicios</div>
          </div>
          <div className="rounded-xl border border-ink/10 bg-ivory p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Código de acceso</div>
            <div className="mt-1 flex items-center gap-2">
              <span className="font-display text-xl font-bold tracking-widest text-melo">{worker.code}</span>
              <Button
                size="icon" variant="ghost" className="h-7 w-7"
                onClick={() => { navigator.clipboard?.writeText(worker.code); toast({ title: "Código copiado" }); }}
                aria-label="Copiar código"
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="text-xs text-ink-soft">Es su contraseña para entrar al panel</div>
          </div>
        </div>
        <WorkerProfile worker={worker} onChanged={onChanged} />
      </TabsContent>

      <TabsContent value="servicios" className="mt-4">
        <WorkerServices worker={worker} services={services} onChanged={onChanged} />
      </TabsContent>

      <TabsContent value="disponibilidad" className="mt-4">
        <AvailabilityEditor barberId={worker.id} canEdit note="Como propietario siempre puedes editar esta disponibilidad." />
      </TabsContent>
    </Tabs>
  );
}

function WorkerProfile({ worker, onChanged }: { worker: Barber; onChanged: () => void }) {
  const [name, setName] = useState(worker.name);
  const [bio, setBio] = useState(worker.bio);
  const [specialty, setSpecialty] = useState(worker.specialty);
  const [phone, setPhone] = useState(worker.phone ?? "");
  const [active, setActive] = useState(worker.active);
  const [code, setCode] = useState(worker.code);
  const [photo, setPhoto] = useState<string | null>(worker.photo);
  const [perms, setPerms] = useState<Record<string, boolean>>(worker.permissions ?? {});
  const [customPerm, setCustomPerm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setPhoto(await fileToDataURL(file, 500));
    } catch {
      setErr("No se pudo cargar la imagen");
    }
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      mutateDB((d) => {
        const b = d.barbers.find((x) => x.id === worker.id);
        if (!b) return;
        b.name = name.trim() || b.name;
        b.bio = bio.trim();
        b.specialty = specialty.trim();
        b.phone = phone || null;
        b.active = active;
        b.code = code.trim().toUpperCase();
        b.photo = photo;
        b.permissions = perms;
      });
      audit("USER", worker.id, "UPDATE_PROFILE", "Propietario", { name: worker.name, perms: worker.permissions }, { name, perms });
      onChanged();
      toast({ title: "Perfil actualizado", description: "Los permisos aplican de inmediato en su panel." });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-2xl border border-ink/10 bg-ivory p-5">
        <div className="mb-3 flex items-center gap-2 font-display text-lg font-bold"><Users className="h-5 w-5 text-brass-dark" /> Perfil</div>
        <div className="mb-4 flex items-center gap-4">
          {photo ? (
            <img src={photo} alt={name} className="h-20 w-20 rounded-2xl object-cover ring-4 ring-brass/30" />
          ) : (
            <span className="flex h-20 w-20 items-center justify-center rounded-2xl bg-brass/15 font-display text-2xl font-bold text-brass-dark">
              {name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
            </span>
          )}
          <label className="cursor-pointer">
            <span className="inline-flex items-center gap-2 rounded-xl border border-brass/50 bg-brass/10 px-3 py-2 text-sm font-medium text-brass-dark hover:bg-brass/20">
              <Camera className="h-4 w-4" /> Subir foto de perfil
            </span>
            <input type="file" accept="image/*" className="hidden" onChange={onPhoto} />
          </label>
        </div>
        <div className="grid gap-3">
          <div className="grid gap-1"><Label>Nombre</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="grid gap-1"><Label>Especialidad (visible al público)</Label><Input value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="Ej: Fades y diseño" /></div>
          <div className="grid gap-1"><Label>Reseña corta (bio pública)</Label><Textarea rows={3} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Cuéntale a los clientes tu experiencia y estilo…" /></div>
          <div className="grid gap-1"><Label>Teléfono</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+57 …" /></div>
          <div className="grid gap-1">
            <Label>Código de acceso (su contraseña)</Label>
            <div className="flex gap-2">
              <Input value={code} onChange={(e) => setCode(e.target.value)} className="font-mono tracking-widest" />
              <Button
                type="button" variant="outline" className="border-ink/20"
                onClick={() => setCode(barberAccessCode(name))}
              >
                Generar
              </Button>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm"><Switch checked={active} onCheckedChange={setActive} /> Barbero activo (puede recibir citas y entrar al panel)</label>
        </div>
      </div>

      <div className="rounded-2xl border border-ink/10 bg-ivory p-5">
        <div className="mb-1 flex items-center gap-2 font-display text-lg font-bold"><KeyRound className="h-5 w-5 text-brass-dark" /> Accesos que le permites</div>
        <p className="mb-3 text-xs text-ink-soft">Por defecto el barbero ve su día y su agenda. Activa solo lo que quieras concederle; los cambios aplican al instante en su panel.</p>
        <div className="grid gap-2">
          {Object.entries(PERM_LABELS).map(([k, label]) => (
            <label key={k} className="flex items-start gap-3 rounded-xl border border-ink/10 bg-cream p-3">
              <Checkbox checked={!!perms[k]} onCheckedChange={(c) => setPerms((p) => ({ ...p, [k]: !!c }))} />
              <span className="text-sm">{label}</span>
            </label>
          ))}
          {Object.keys(perms).filter((k) => !PERM_LABELS[k]).map((k) => (
            <label key={k} className="flex items-start gap-3 rounded-xl border border-brass/40 bg-brass/5 p-3">
              <Checkbox checked={!!perms[k]} onCheckedChange={(c) => setPerms((p) => ({ ...p, [k]: !!c }))} />
              <span className="text-sm">{k} <span className="text-xs text-ink-soft">(permiso personalizado)</span></span>
            </label>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <Input value={customPerm} onChange={(e) => setCustomPerm(e.target.value)} placeholder="Nuevo permiso personalizado (ej: promo.manage)" className="text-xs" />
          <Button
            type="button" variant="outline" className="border-brass/50 text-brass-dark"
            disabled={!customPerm.trim()}
            onClick={() => {
              const k = customPerm.trim();
              setPerms((p) => ({ ...p, [k]: true }));
              setCustomPerm("");
            }}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        {err ? <div className="mt-3 rounded-lg bg-melo/10 p-2 text-sm text-melo-dark">{err}</div> : null}
        <Button disabled={busy} onClick={save} className="mt-4 w-full bg-ink hover:bg-ink/80 text-ivory">Guardar cambios</Button>
      </div>
    </div>
  );
}

function WorkerServices({ worker, services, onChanged }: { worker: Barber; services: Service[]; onChanged: () => void }) {
  const db = getDB();
  const [auth, setAuth] = useState<Map<string, boolean>>(
    new Map(services.map((s) => [s.id, !!db.barberServices[`${worker.id}:${s.id}`]]))
  );

  async function save() {
    mutateDB((d) => {
      for (const [sid, on] of auth) d.barberServices[`${worker.id}:${sid}`] = on;
    });
    audit("BARBER_SERVICE", worker.id, "UPDATE_AUTH", "Propietario", null, Object.fromEntries(auth));
    onChanged();
    toast({ title: "Autorizaciones guardadas", description: "Aplican para reservas web y citas manuales." });
  }

  return (
    <div className="rounded-2xl border border-ink/10 bg-ivory p-5">
      <p className="mb-4 text-sm text-ink-soft">Define qué servicios puede ofrecer. Un servicio sin autorización no aparece en sus horarios y no puede completarse.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {services.map((s) => (
          <label key={s.id} className="flex items-center gap-3 rounded-xl border border-ink/10 bg-cream p-3 text-sm">
            <Checkbox checked={!!auth.get(s.id)} onCheckedChange={(c) => setAuth((m) => new Map(m).set(s.id, !!c))} />
            <span className="font-medium">{s.name}</span>
            <span className="ml-auto text-ink-soft tabular-nums">{cop(s.price)}</span>
          </label>
        ))}
      </div>
      <Button onClick={save} className="mt-4 bg-ink hover:bg-ink/80 text-ivory">Guardar autorizaciones</Button>
    </div>
  );
}

function NewWorkerDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string, code: string) => void }) {
  const [name, setName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setErr(null);
    try {
      const code = barberAccessCode(name);
      mutateDB((d) => {
        const id = cuid("b");
        d.barbers.push({
          id,
          name: name.trim(),
          bio: "",
          photo: null,
          code,
          active: true,
          phone: phone || null,
          specialty: specialty.trim(),
          permissions: { "payments.register": true, "commissions.view": true, "settlements.view": true, "profile.edit": true },
          createdAt: new Date().toISOString(),
        });
        // disponibilidad por defecto: martes a sábado
        d.availability[id] = [];
        for (let day = 2; day <= 6; day++) {
          d.availability[id].push({ dayOfWeek: day, startTime: "10:00", endTime: "13:00", active: true });
          d.availability[id].push({ dayOfWeek: day, startTime: "14:00", endTime: "19:00", active: true });
        }
        // autorizar todos los servicios activos
        for (const s of d.services) if (s.active) d.barberServices[`${id}:${s.id}`] = true;
      });
      audit("USER", name, "CREATE_BARBER", "Propietario", null, { name, code });
      onCreated(name, code);
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
          <div className="grid gap-1"><Label>Especialidad (opcional)</Label><Input value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="Ej: Cortes clásicos" /></div>
          <div className="grid gap-1"><Label>Teléfono (opcional)</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          <p className="text-xs text-ink-soft">Se genera un código único de acceso que él usará como contraseña. Podrás cambiarlo en su perfil.</p>
          {err ? <div className="rounded-lg bg-melo/10 p-2 text-sm text-melo-dark">{err}</div> : null}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={busy || name.trim().length < 3} onClick={create} className="bg-melo hover:bg-melo-dark text-ivory">Crear barbero</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================ DISPONIBILIDAD
export function AvailabilityEditor({ barberId, canEdit, note }: { barberId: string; canEdit: boolean; note?: string }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const h = () => setTick((n) => n + 1);
    window.addEventListener("melo:db-changed", h);
    return () => window.removeEventListener("melo:db-changed", h);
  }, []);

  const db = getDB();
  const rows = db.availability[barberId] ?? [];
  const [draft, setDraft] = useState<Array<{ dayOfWeek: number; startTime: string; endTime: string }>>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!dirty) setDraft(rows.map((r) => ({ dayOfWeek: r.dayOfWeek, startTime: r.startTime, endTime: r.endTime })));
  }, [tick, rows, dirty]);

  function addWindow(day: number) {
    setDirty(true);
    setDraft((r) => [...r, { dayOfWeek: day, startTime: "10:00", endTime: "12:00" }]);
  }
  function removeRow(i: number) {
    setDirty(true);
    setDraft((r) => r.filter((_, idx) => idx !== i));
  }
  function update(i: number, patch: Partial<{ dayOfWeek: number; startTime: string; endTime: string }>) {
    setDirty(true);
    setDraft((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  async function save() {
    setBusy(true);
    try {
      const before = [...rows];
      mutateDB((d) => {
        d.availability[barberId] = draft.map((r) => ({ ...r, active: true }));
      });
      audit("AVAILABILITY", barberId, "UPDATE", "Propietario", before, draft);
      toast({ title: "Disponibilidad guardada", description: "Los nuevos horarios aplican para futuras reservas." });
      setDirty(false);
      setTick((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-ink/10 bg-ivory p-5">
      <div className="mb-1 flex items-center gap-2 font-display text-lg font-bold"><CalendarDays className="h-5 w-5 text-brass-dark" /> Disponibilidad semanal</div>
      <p className="mb-4 text-xs text-ink-soft">{note ?? ""} Las ventanas definen dónde pueden caer las citas; los solapamientos se revisan siempre.</p>
      {canEdit ? (
        <>
          <div className="grid gap-3">
            {draft.length === 0 ? <div className="rounded-xl border border-dashed border-ink/15 px-4 py-6 text-center text-sm text-ink-soft">Sin ventanas: el barbero no recibe citas.</div> : null}
            {draft.map((r, i) => (
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
                <Button variant="ghost" size="icon" className="text-melo-dark" onClick={() => removeRow(i)} aria-label="Quitar"><span className="text-lg leading-none">×</span></Button>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => addWindow(2)} className="border-brass/50 text-brass-dark hover:bg-brass/10"><Plus className="mr-1 h-4 w-4" /> Agregar ventana</Button>
            <Button disabled={busy} onClick={save} className="bg-ink hover:bg-ink/80 text-ivory">Guardar disponibilidad</Button>
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-ink/15 bg-cream px-4 py-6 text-center text-sm text-ink-soft">
          Solo lectura: el propietario define tus ventanas.
        </div>
      )}
    </div>
  );
}

/** Vista del barbero para su propia disponibilidad. */
export function MyAvailabilityView({ user }: { user: SessionUser }) {
  const db = getDB();
  const barber = db.barbers.find((b) => b.id === user.id);
  const canEdit = !!barber?.permissions["schedule.manageOwn"];
  return (
    <div>
      <SectionTitle
        title="Mi disponibilidad"
        sub={canEdit ? "Edita tus ventanas horarias; el propietario también puede hacerlo." : "Consulta tu horario semanal. Para editarlo pide el permiso al propietario."}
      />
      <AvailabilityEditor barberId={user.id} canEdit={canEdit} note="" />
    </div>
  );
}

/** Historial de modificaciones (auditoría) — propietario. */
export function AuditView() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const h = () => setTick((n) => n + 1);
    window.addEventListener("melo:db-changed", h);
    return () => window.removeEventListener("melo:db-changed", h);
  }, []);
  const [entity, setEntity] = useState("");
  const [openFor, setOpenFor] = useState<{ title: string; before: string; after: string } | null>(null);

  const db = getDB();
  const logs = db.auditLogs.filter((l) => (entity ? l.entity === entity : true));
  const entities = Array.from(new Set(db.auditLogs.map((l) => l.entity)));

  return (
    <div>
      <SectionTitle title="Historial de modificaciones" sub="Cada cambio relevante queda con su antes/después y autor. Nada se modifica en silencio." />
      <div className="mb-3">
        <Select value={entity || "ALL"} onValueChange={(v) => setEntity(v === "ALL" ? "" : v)}>
          <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Todas las entidades</SelectItem>
            {entities.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {logs.length === 0 ? <EmptyState title="Sin registros" /> : (
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
              {logs.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="whitespace-nowrap text-sm">{fmtDateMedium(new Date(l.createdAt))} {timeHMInBogota(new Date(l.createdAt))}</TableCell>
                  <TableCell><Chip>{l.entity}</Chip></TableCell>
                  <TableCell className="text-sm font-medium">{l.action}</TableCell>
                  <TableCell className="text-sm text-ink-soft">{l.userName}</TableCell>
                  <TableCell>
                    <Button
                      size="sm" variant="ghost" className="h-7 text-xs"
                      onClick={() =>
                        setOpenFor({
                          title: `${l.entity} · ${l.action}`,
                          before: l.before ? JSON.stringify(l.before, null, 2) : "—",
                          after: l.after ? JSON.stringify(l.after, null, 2) : "—",
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
      )}

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
