"use client";
// Notificaciones (ambos roles), Comunidad (mini red social) y Mi perfil (barbero).
import { useEffect, useMemo, useState } from "react";
import { fmtDateMedium, timeHMInBogota } from "@/lib/time";
import {
  getDB, mutateDB, cuid, deviceId, audit, getAdminData,
  type SessionUser, type Post, type Comment,
} from "@/lib/store";
import { permissionState, setupNotificationPersistence, playPreviewSound, currentSound, type NotifPermState } from "@/lib/notify-client";
import { SectionTitle, EmptyState, Chip } from "@/components/melo/ui";
import { LEVELS, barberLevel } from "@/components/melo/Dashboards";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { toast, useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Bell, CheckCheck, Star, Heart, Trash2, EyeOff, Eye, Camera, Plus, Video, Image as ImageIcon,
  Send, MessageCircle, Lock, ShieldAlert, Volume2, Smartphone, BellRing,
} from "lucide-react";

// ============================================================ NOTIFICACIONES
export function NotificationsView({ user }: { user: SessionUser }) {
  const [tick, setTick] = useState(0);
  const [perm, setPerm] = useState<NotifPermState>("default");
  useEffect(() => {
    const h = () => setTick((n) => n + 1);
    window.addEventListener("melo:db-changed", h);
    setupNotificationPersistence(setPerm);
    return () => window.removeEventListener("melo:db-changed", h);
  }, []);

  const db = getDB();
  const myId = user.role === "OWNER" ? "OWNER" : user.id;
  const notifications = db.notifications.filter((n) => n.userId === myId);
  const admin = getAdminData();

  function markAll() {
    mutateDB((d) => {
      for (const n of d.notifications) if (n.userId === myId) n.read = true;
    });
    setTick((n) => n + 1);
  }

  return (
    <div>
      <SectionTitle
        title="Notificaciones"
        sub="Reservas, cancelaciones, pagos y servicios completados. Con las notificaciones del dispositivo activadas te enteras aunque estés en otra app."
        right={
          <Button variant="outline" onClick={markAll} className="border-brass/50 text-brass-dark hover:bg-brass/10">
            <CheckCheck className="mr-1 h-4 w-4" /> Marcar todas leídas
          </Button>
        }
      />

      {/* estado de permisos push */}
      <div className={cn(
        "mb-5 flex flex-wrap items-center gap-3 rounded-2xl border p-4",
        perm === "granted" ? "border-good/40 bg-good/5" : perm === "denied" ? "border-melo/40 bg-melo/10" : "border-warn/40 bg-warn/5"
      )}>
        {perm === "granted" ? <BellRing className="h-6 w-6 text-good" /> : perm === "denied" ? <ShieldAlert className="h-6 w-6 text-melo-dark" /> : <Smartphone className="h-6 w-6 text-warn" />}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">
            {perm === "granted" ? "Notificaciones del dispositivo activadas ✔" : perm === "denied" ? "Notificaciones bloqueadas en este dispositivo" : "Notificaciones del dispositivo sin activar"}
          </div>
          <div className="text-xs text-ink-soft">
            {perm === "granted"
              ? `Sonido: ${admin.notif.sound} · vibración ${admin.notif.vibrate ? "activada" : "desactivada"}. Llegan sobre cualquier pantalla.`
              : perm === "denied"
                ? "Desbloquéalas desde el icono del candado/ajustes de la barra de direcciones del navegador para no perderte reservas."
                : "El sistema te las pedirá constantemente hasta que las actives; así no se pierde ninguna reserva."}
          </div>
        </div>
        {perm !== "granted" ? (
          <Button
            size="sm"
            className="bg-ink text-ivory hover:bg-ink/80"
            onClick={async () => {
              const { requestPermission } = await import("@/lib/notify-client");
              const r = await requestPermission();
              setPerm(r);
            }}
          >
            Activar ahora
          </Button>
        ) : null}
      </div>

      {notifications.length === 0 ? (
        <EmptyState icon={<Bell className="h-8 w-8" />} title="Sin notificaciones" sub="Cuando haya eventos aparecerán aquí." />
      ) : (
        <div className="flex max-h-125 flex-col gap-2 overflow-y-auto pr-1 nice-scroll">
          {notifications.map((n) => (
            <div key={n.id} className={cn("rounded-xl border p-4", n.read ? "border-ink/10 bg-ivory opacity-75" : "border-brass/40 bg-brass/5")}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("text-sm font-semibold", n.read ? "text-ink/70" : "text-ink")}>{n.title}</span>
                {!n.read ? <Chip className="border-melo/40 text-melo-dark">nueva</Chip> : null}
                <Chip className="ml-auto">{n.type}</Chip>
                <span className="text-[11px] text-ink/40">{fmtDateMedium(new Date(n.createdAt))} {timeHMInBogota(new Date(n.createdAt))}</span>
              </div>
              <div className="mt-1 text-sm text-ink-soft">{n.message}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================ COMUNIDAD (moderación del dueño)
export function SocialModerationView() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const h = () => setTick((n) => n + 1);
    window.addEventListener("melo:db-changed", h);
    return () => window.removeEventListener("melo:db-changed", h);
  }, []);
  const [barberFilter, setBarberFilter] = useState("ALL");
  const [tab, setTab] = useState("posts");

  const db = getDB();
  const posts = db.posts.filter((p) => (barberFilter === "ALL" ? true : p.barberId === barberFilter));
  const comments = db.comments.filter((c) => (barberFilter === "ALL" ? true : c.barberId === barberFilter));

  function toggleHidePost(postId: string) {
    mutateDB((d) => {
      const p = d.posts.find((x) => x.id === postId);
      if (p) p.hidden = !p.hidden;
    });
    audit("POST", postId, "TOGGLE_HIDE", "Propietario");
    setTick((n) => n + 1);
  }
  function deletePost(postId: string) {
    mutateDB((d) => {
      d.posts = d.posts.filter((x) => x.id !== postId);
      d.comments = d.comments.filter((c) => c.postId !== postId);
    });
    audit("POST", postId, "DELETE", "Propietario");
    setTick((n) => n + 1);
    toast({ title: "Publicación eliminada" });
  }
  function toggleHideComment(commentId: string) {
    mutateDB((d) => {
      const c = d.comments.find((x) => x.id === commentId);
      if (c) c.hidden = !c.hidden;
    });
    audit("COMMENT", commentId, "TOGGLE_HIDE", "Propietario");
    setTick((n) => n + 1);
  }
  function deleteComment(commentId: string) {
    mutateDB((d) => {
      d.comments = d.comments.filter((x) => x.id !== commentId);
    });
    audit("COMMENT", commentId, "DELETE", "Propietario");
    setTick((n) => n + 1);
    toast({ title: "Comentario eliminado" });
  }

  return (
    <div>
      <SectionTitle
        title="Comunidad"
        sub="La mini red social de tus barberos: aprueba, oculta o elimina publicaciones y comentarios. Solo tú puedes borrar contenido de los clientes."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Select value={barberFilter} onValueChange={setBarberFilter}>
          <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Todos los barberos</SelectItem>
            {db.barbers.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-3">
        <Tabsish value={tab} onChange={setTab} />
        {tab === "posts" ? (
          posts.length === 0 ? (
            <EmptyState title="Sin publicaciones" sub="Los barberos con permiso de perfil pueden subir fotos y videos de sus trabajos." />
          ) : (
            <div className="grid gap-3">
              {posts.map((p) => {
                const barber = db.barbers.find((b) => b.id === p.barberId);
                return (
                  <div key={p.id} className={cn("rounded-2xl border p-4", p.hidden ? "border-ink/10 bg-cream/60 opacity-75" : "border-ink/10 bg-ivory")}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{barber?.name ?? "—"}</span>
                      <Chip>{p.media[0]?.type === "VIDEO" ? "video" : "foto"}{p.media.length > 1 ? ` ×${p.media.length}` : ""}</Chip>
                      <Chip className="border-melo/40 text-melo-dark">❤️ {p.likes.length}</Chip>
                      <Chip>{db.comments.filter((c) => c.postId === p.id).length} comentarios</Chip>
                      {p.hidden ? <Chip className="border-ink/30 text-ink-soft">oculta</Chip> : null}
                      <span className="ml-auto text-[11px] text-ink/40">{fmtDateMedium(new Date(p.createdAt))}</span>
                    </div>
                    {p.caption ? <p className="mt-1 text-sm text-ink-soft">{p.caption}</p> : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {p.media.map((m, i) => (
                        m.type === "VIDEO" ? (
                          <video key={i} src={m.src} className="h-20 w-28 rounded-lg object-cover" muted playsInline preload="metadata" />
                        ) : (
                          <img key={i} src={m.src} alt="" className="h-20 w-28 rounded-lg object-cover" />
                        )
                      ))}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <Button size="sm" variant="outline" className="h-7 border-ink/20" onClick={() => toggleHidePost(p.id)}>
                        {p.hidden ? <><Eye className="mr-1 h-3 w-3" /> Mostrar</> : <><EyeOff className="mr-1 h-3 w-3" /> Ocultar</>}
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 border-melo/40 text-melo-dark" onClick={() => deletePost(p.id)}>
                        <Trash2 className="mr-1 h-3 w-3" /> Eliminar
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          comments.length === 0 ? (
            <EmptyState title="Sin comentarios" sub="Los comentarios y reseñas de los clientes aparecerán aquí para su moderación." />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-ink/10 bg-ivory">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Autor</TableHead>
                    <TableHead>Barbero</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Contenido</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {comments.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((c) => (
                    <TableRow key={c.id} className={c.hidden ? "opacity-60" : ""}>
                      <TableCell className="whitespace-nowrap text-xs">{fmtDateMedium(new Date(c.createdAt))}</TableCell>
                      <TableCell className="text-sm font-medium">{c.authorName}</TableCell>
                      <TableCell className="text-sm">{db.barbers.find((b) => b.id === c.barberId)?.name ?? "—"}</TableCell>
                      <TableCell>
                        {c.rating ? (
                          <span className="inline-flex items-center gap-0.5">
                            {Array.from({ length: 5 }, (_, i) => (
                              <Star key={i} className={cn("h-3 w-3", i < c.rating! ? "fill-brass text-brass" : "text-ink/20")} />
                            ))}
                          </span>
                        ) : (
                          <Chip>comentario</Chip>
                        )}
                      </TableCell>
                      <TableCell className="max-w-64 truncate text-sm text-ink-soft">{c.text}</TableCell>
                      <TableCell className="text-xs">{c.hidden ? "oculto" : "visible"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="h-7" onClick={() => toggleHideComment(c.id)}>
                            {c.hidden ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-melo-dark" onClick={() => deleteComment(c.id)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )
        )}
      </div>
    </div>
  );
}

function Tabsish({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-2">
      {[
        { id: "posts", label: "Publicaciones" },
        { id: "comments", label: "Comentarios y reseñas" },
      ].map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            "rounded-full border px-4 py-2 text-sm font-medium transition",
            value === t.id ? "border-ink bg-ink text-ivory" : "border-ink/15 bg-ivory text-ink-soft"
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ============================================================ MI PERFIL (barbero)
export function MyProfileView({ user }: { user: SessionUser }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const h = () => setTick((n) => n + 1);
    window.addEventListener("melo:db-changed", h);
    return () => window.removeEventListener("melo:db-changed", h);
  }, []);

  const db = getDB();
  const barber = db.barbers.find((b) => b.id === user.id);
  if (!barber) return <EmptyState title="Perfil no encontrado" />;
  const canEdit = !!barber.permissions["profile.edit"];

  const posts = db.posts.filter((p) => p.barberId === user.id && !p.hidden);
  const reviews = db.comments.filter((c) => c.barberId === user.id && c.postId === null && !c.hidden && c.rating);
  const avg = reviews.length ? Math.round((reviews.reduce((s, c) => s + (c.rating ?? 0), 0) / reviews.length) * 10) / 10 : 0;
  const done = db.appointments.filter((a) => a.barberId === user.id && a.status === "COMPLETED").length;
  const likes = posts.reduce((s, p) => s + p.likes.length, 0);
  const lvl = barberLevel(done);

  return (
    <div>
      <SectionTitle
        title="Mi perfil"
        sub="Tu tarjeta pública: foto, reseña, trabajos y puntaje. Los clientes la ven al elegirte en la reserva."
      />

      {/* resumen social */}
      <div className="mb-6 rounded-2xl border border-brass/40 bg-gradient-to-r from-brass/10 to-ivory p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            {barber.photo ? (
              <img src={barber.photo} alt={barber.name} className="h-16 w-16 rounded-2xl object-cover ring-4 ring-brass/30" />
            ) : (
              <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brass/15 font-display text-2xl font-bold text-brass-dark">
                {barber.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
              </span>
            )}
            <div>
              <div className="font-display text-xl font-bold">{barber.name} <span className="ml-1">{lvl.current.icon}</span></div>
              <div className="text-sm text-ink-soft">{barber.specialty || "Barbero profesional"}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                <Chip className="border-brass/40 text-brass-dark"><Star className="h-3.5 w-3.5 fill-brass" /> {avg || "—"} / 5</Chip>
                <Chip className="border-melo/40 text-melo-dark">❤️ {likes}</Chip>
                <Chip>✂️ {done} servicios</Chip>
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-ink-soft">Nivel</div>
            <div className="font-display text-2xl font-bold">{lvl.current.name}</div>
            {lvl.next ? <div className="text-xs text-ink-soft">{done}/{lvl.next.min} para {lvl.next.name} {lvl.next.icon}</div> : <div className="text-xs text-ink-soft">¡Nivel máximo! 👑</div>}
          </div>
        </div>
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs text-ink-soft">
            <span>Progreso</span>
            <span>{LEVELS.map((l) => `${l.icon} ${l.name} (${l.min})`).join(" · ")}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-ink/10">
            <div className="h-full rounded-full bg-gradient-to-r from-brass to-melo transition-all" style={{ width: `${lvl.progress}%` }} />
          </div>
        </div>
      </div>

      {!canEdit ? (
        <div className="rounded-xl border border-dashed border-ink/15 bg-cream p-6 text-center text-sm text-ink-soft">
          <Lock className="mx-auto mb-2 h-5 w-5" />
          El propietario aún no te ha dado permiso para editar tu perfil y subir trabajos. Pídeselo desde tu próximo ajuste de accesos.
        </div>
      ) : (
        <BarberProfileEditor barber={barber} onChanged={() => setTick((n) => n + 1)} />
      )}
    </div>
  );
}

function BarberProfileEditor({ barber, onChanged }: { barber: ReturnType<typeof getDB>["barbers"][number]; onChanged: () => void }) {
  const [bio, setBio] = useState(barber.bio);
  const [specialty, setSpecialty] = useState(barber.specialty);
  const [photo, setPhoto] = useState<string | null>(barber.photo);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  async function compressFile(file: File, isVideo: boolean): Promise<string> {
    if (isVideo) {
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("no se pudo leer"));
        reader.readAsDataURL(file);
      });
    }
    // imagen: reescalar
    const { } = { };
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, 1100 / Math.max(img.width, img.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          const ctx = canvas.getContext("2d");
          if (!ctx) { reject(new Error("sin canvas")); return; }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.8));
        };
        img.onerror = () => reject(new Error("imagen inválida"));
        img.src = reader.result as string;
      };
      reader.onerror = () => reject(new Error("no se pudo leer"));
      reader.readAsDataURL(file);
    });
  }

  async function saveProfile() {
    setBusy(true);
    try {
      mutateDB((d) => {
        const b = d.barbers.find((x) => x.id === barber.id);
        if (!b) return;
        b.bio = bio.trim();
        b.specialty = specialty.trim();
        b.photo = photo;
      });
      onChanged();
      toast({ title: "Perfil actualizado" });
    } finally {
      setBusy(false);
    }
  }

  async function uploadPost(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      const media = [] as Array<{ type: "IMAGE" | "VIDEO"; src: string }>;
      for (const f of Array.from(files).slice(0, 4)) {
        const isVideo = f.type.startsWith("video/");
        const src = await compressFile(f, isVideo);
        media.push({ type: isVideo ? "VIDEO" : "IMAGE", src });
      }
      mutateDB((d) => {
        d.posts.unshift({
          id: cuid("post"),
          barberId: barber.id,
          caption: caption.trim(),
          media,
          likes: [],
          createdAt: new Date().toISOString(),
        });
      });
      setCaption("");
      onChanged();
      toast({ title: "Trabajo publicado", description: "Ya es visible en tu perfil público." });
    } catch (e) {
      toast({ title: "No se pudo subir", description: e instanceof Error ? e.message : "Error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  function deletePost(postId: string) {
    mutateDB((d) => {
      d.posts = d.posts.filter((x) => x.id !== postId);
      d.comments = d.comments.filter((c) => c.postId !== postId);
    });
    onChanged();
    toast({ title: "Publicación eliminada" });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-2xl border border-ink/10 bg-ivory p-5">
        <div className="mb-3 font-display text-lg font-bold">Mi tarjeta pública</div>
        <div className="mb-4 flex items-center gap-4">
          {photo ? (
            <img src={photo} alt={barber.name} className="h-20 w-20 rounded-2xl object-cover ring-4 ring-brass/30" />
          ) : (
            <span className="flex h-20 w-20 items-center justify-center rounded-2xl bg-brass/15 font-display text-2xl font-bold text-brass-dark">
              {barber.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
            </span>
          )}
          <label className="cursor-pointer">
            <span className="inline-flex items-center gap-2 rounded-xl border border-brass/50 bg-brass/10 px-3 py-2 text-sm font-medium text-brass-dark hover:bg-brass/20">
              <Camera className="h-4 w-4" /> Cambiar foto
            </span>
            <input
              type="file" accept="image/*" className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  const src = await compressFile(f, false);
                  setPhoto(typeof src === "string" ? src : null);
                } catch {
                  toast({ title: "No se pudo cargar la imagen", variant: "destructive" });
                }
              }}
            />
          </label>
        </div>
        <div className="grid gap-3">
          <div className="grid gap-1"><Label>Especialidad</Label><Input value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="Ej: Fades y diseño" /></div>
          <div className="grid gap-1"><Label>Reseña corta</Label><Textarea rows={4} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Cuéntale a los clientes tu experiencia y estilo…" /></div>
          <Button disabled={busy} onClick={saveProfile} className="bg-ink text-ivory hover:bg-ink/80">Guardar perfil</Button>
        </div>
      </div>

      <div className="rounded-2xl border border-ink/10 bg-ivory p-5">
        <div className="mb-1 font-display text-lg font-bold">Mis trabajos</div>
        <p className="mb-3 text-xs text-ink-soft">Sube fotos o videos de tus cortes: se muestran en tu perfil público y acumulan me gusta y comentarios.</p>
        <div className="mb-3 grid gap-2">
          <Input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Descripción del trabajo (opcional)" />
          <label className="cursor-pointer">
            <span className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-brass/50 bg-brass/5 px-3 py-3 text-sm font-medium text-brass-dark hover:bg-brass/10">
              <Plus className="h-4 w-4" /> <Video className="h-4 w-4" /> <ImageIcon className="h-4 w-4" /> Subir fotos o videos
            </span>
            <input type="file" accept="image/*,video/*" multiple className="hidden" onChange={(e) => uploadPost(e.target.files)} disabled={busy} />
          </label>
        </div>
        {busy ? <div className="text-sm text-ink-soft">Procesando…</div> : null}
        <div className="grid max-h-96 gap-3 overflow-y-auto pr-1 nice-scroll">
          {getDB().posts.filter((p) => p.barberId === barber.id).map((p) => (
            <div key={p.id} className={cn("rounded-xl border p-3", p.hidden ? "border-ink/10 bg-cream/60 opacity-70" : "border-ink/10 bg-cream")}>
              <div className="flex items-center gap-2">
                <Chip>{p.media[0]?.type === "VIDEO" ? "video" : "foto"}{p.media.length > 1 ? ` ×${p.media.length}` : ""}</Chip>
                <Chip className="border-melo/40 text-melo-dark">❤️ {p.likes.length}</Chip>
                <Chip><MessageCircle className="h-3 w-3" /> {getDB().comments.filter((c) => c.postId === p.id && !c.hidden).length}</Chip>
                <Button size="sm" variant="ghost" className="ml-auto h-7 text-melo-dark" onClick={() => deletePost(p.id)}><Trash2 className="h-3 w-3" /></Button>
              </div>
              {p.caption ? <div className="mt-1 text-sm text-ink-soft">{p.caption}</div> : null}
              <div className="mt-2 flex gap-2">
                {p.media.map((m, i) => (
                  m.type === "VIDEO" ? (
                    <video key={i} src={m.src} className="h-16 w-24 rounded-lg object-cover" muted playsInline preload="metadata" />
                  ) : (
                    <img key={i} src={m.src} alt="" className="h-16 w-24 rounded-lg object-cover" />
                  )
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
