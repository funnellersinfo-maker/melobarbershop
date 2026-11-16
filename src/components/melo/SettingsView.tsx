"use client";
// Configuración central del dueño: sitio público (hero, multimedia, horarios,
// membrete, secciones, FAQ), WhatsApp, notificaciones push y sonidos.
// Nada técnico, todo agrupado y en lenguaje claro.
import { useEffect, useState } from "react";
import {
  getAdminData, saveAdminData, getDB, isOwnerPremium, ownerAutoXP, seedOwnerProfile,
  type SiteConfig, type NotifConfig, type OwnerProfile,
} from "@/lib/store";
import { LEVELS, barberLevel } from "@/components/melo/Dashboards";
import { permissionState, playPreviewSound, setupNotificationPersistence, type NotifPermState } from "@/lib/notify-client";
import { SectionTitle, Chip } from "@/components/melo/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Save, ImageIcon, Video, Trash2, Plus, Volume2, BellRing, Smartphone, ShieldAlert, MessageCircle, Sparkles, ListChecks,
  User, Zap, Crown, Lock,
} from "lucide-react";

const SOUNDS: Array<{ id: NotifConfig["sound"]; label: string }> = [
  { id: "ding", label: "Ding (corto)" },
  { id: "chime", label: "Campanilla (ascendente)" },
  { id: "bell", label: "Campana (clásica)" },
  { id: "pulse", label: "Pulso (insistente)" },
  { id: "none", label: "Sin sonido" },
];

// ---------- subir imagen a dataURL ----------
function fileToDataURL(file: File, maxSize = 1600): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.type.startsWith("video/")) {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("no se pudo leer"));
      reader.readAsDataURL(file);
      return;
    }
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
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.onerror = () => reject(new Error("imagen inválida"));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error("no se pudo leer"));
    reader.readAsDataURL(file);
  });
}

export function SettingsView() {
  const [site, setSite] = useState<SiteConfig | null>(null);
  const [notif, setNotif] = useState<NotifConfig | null>(null);
  const [profile, setProfile] = useState<OwnerProfile | null>(null);
  const [perm, setPerm] = useState<NotifPermState>("default");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const admin = getAdminData();
    setSite(admin.site);
    setNotif(admin.notif);
    setProfile(admin.profile ?? seedOwnerProfile());
    setupNotificationPersistence(setPerm);
  }, []);

  if (!site || !notif || !profile) return null;

  const siteCfg: SiteConfig = site;
  const notifCfg: NotifConfig = notif;
  const profileCfg: OwnerProfile = profile;

  function set<K extends keyof SiteConfig>(k: K, v: SiteConfig[K]) {
    setSite((s) => (s ? { ...s, [k]: v } : s));
  }
  function setN<K extends keyof NotifConfig>(k: K, v: NotifConfig[K]) {
    setNotif((n) => (n ? { ...n, [k]: v } : n));
  }

  function setP<K extends keyof OwnerProfile>(k: K, v: OwnerProfile[K]) {
    setProfile((p) => (p ? { ...p, [k]: v } : p));
  }

  async function save() {
    setBusy(true);
    try {
      saveAdminData({ version: 1, site: siteCfg, notif: notifCfg, profile: profileCfg });
      toast({ title: "Configuración guardada", description: "El sitio público ya refleja tus cambios." });
    } finally {
      setBusy(false);
    }
  }

  async function addMedia(file: File) {
    try {
      const src = await fileToDataURL(file);
      set("heroMedia", [...siteCfg.heroMedia, { id: `m-${Date.now()}`, type: file.type.startsWith("video/") ? "VIDEO" : "IMAGE", src }]);
      if (siteCfg.heroMediaMode === "LOGO") set("heroMediaMode", file.type.startsWith("video/") ? "VIDEO" : "IMAGE");
    } catch {
      toast({ title: "No se pudo cargar el archivo", variant: "destructive" });
    }
  }

  return (
    <div>
      <SectionTitle
        title="Configuración"
        sub="Todo lo que ves en el sitio público se edita aquí: textos del inicio, fotos y videos, horarios, datos de contacto, preguntas frecuentes, tu WhatsApp y las notificaciones con sonido."
        right={
          <Button onClick={save} disabled={busy} className="bg-good hover:bg-good/85 text-ivory">
            <Save className="mr-1 h-4 w-4" /> {busy ? "Guardando…" : "Guardar todo"}
          </Button>
        }
      />

      {/* ============================== MI PERFIL (premium Ronald) ============================== */}
      <OwnerProfileCard profile={profileCfg} setP={setP} />

      {/* ============================== SITIO PÚBLICO ============================== */}
      <SettingsCard icon={<Sparkles className="h-5 w-5" />} title="Inicio (hero) del sitio" desc="Lo primero que ven tus clientes. Cambia textos, agrega fotos o videos y activa el carrusel.">
        <div className="grid gap-3">
          <div className="grid gap-1"><Label>Etiqueta superior</Label><Input value={site.heroBadge} onChange={(e) => set("heroBadge", e.target.value)} /></div>
          <div className="grid gap-1"><Label>Título (primera línea)</Label><Input value={site.heroTitle} onChange={(e) => set("heroTitle", e.target.value)} /></div>
          <div className="grid gap-1"><Label>Título destacado (segunda línea, en rojo)</Label><Input value={site.heroTitleAccent} onChange={(e) => set("heroTitleAccent", e.target.value)} /></div>
          <div className="grid gap-1"><Label>Subtítulo</Label><Textarea rows={3} value={site.heroSubtitle} onChange={(e) => set("heroSubtitle", e.target.value)} /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1"><Label>Botón principal</Label><Input value={site.heroPrimaryCta} onChange={(e) => set("heroPrimaryCta", e.target.value)} /></div>
            <div className="grid gap-1"><Label>Botón secundario</Label><Input value={site.heroSecondaryCta} onChange={(e) => set("heroSecondaryCta", e.target.value)} /></div>
          </div>

          <div className="rounded-xl border border-ink/10 bg-cream p-4">
            <Label>Horarios visibles en el inicio</Label>
            <p className="mb-2 text-xs text-ink-soft">Una línea por horario, tal como se muestra en el hero.</p>
            {site.heroSchedule.map((line, i) => (
              <div key={i} className="mb-2 flex gap-2">
                <Input
                  value={line}
                  onChange={(e) => set("heroSchedule", site.heroSchedule.map((l, idx) => (idx === i ? e.target.value : l)))}
                />
                <Button variant="ghost" size="icon" className="text-melo-dark" onClick={() => set("heroSchedule", site.heroSchedule.filter((_, idx) => idx !== i))} aria-label="Quitar línea">×</Button>
              </div>
            ))}
            <Button variant="outline" size="sm" className="border-brass/50 text-brass-dark" onClick={() => set("heroSchedule", [...site.heroSchedule, ""])}><Plus className="h-4 w-4" /> Agregar línea</Button>
          </div>

          {/* multimedia */}
          <div className="rounded-xl border border-ink/10 bg-cream p-4">
            <Label>Fotos y videos del inicio</Label>
            <p className="mb-2 text-xs text-ink-soft">Sube una imagen o un video para el recuadro del hero, o varias imágenes para el carrusel automático.</p>
            <div className="mb-3 flex flex-wrap gap-2">
              {[
                { id: "LOGO", label: "Logo" },
                { id: "IMAGE", label: "Imagen" },
                { id: "VIDEO", label: "Video" },
                { id: "CAROUSEL", label: "Carrusel" },
              ].map((m) => (
                <button
                  key={m.id}
                  onClick={() => set("heroMediaMode", m.id as SiteConfig["heroMediaMode"])}
                  className={cn(
                    "rounded-full border px-4 py-1.5 text-sm font-medium transition",
                    site.heroMediaMode === m.id ? "border-ink bg-ink text-ivory" : "border-ink/15 bg-ivory text-ink-soft"
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {site.heroMedia.map((m, i) => (
                <div key={m.id} className="relative">
                  {m.type === "VIDEO" ? (
                    <video src={m.src} className="h-20 w-28 rounded-lg object-cover" muted playsInline preload="metadata" />
                  ) : (
                    <img src={m.src} alt="" className="h-20 w-28 rounded-lg object-cover" />
                  )}
                  <button
                    onClick={() => set("heroMedia", site.heroMedia.filter((_, idx) => idx !== i))}
                    className="absolute -right-1.5 -top-1.5 rounded-full bg-melo p-1 text-ivory shadow"
                    aria-label="Quitar"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
            <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-brass/50 bg-brass/5 px-3 py-2 text-sm font-medium text-brass-dark hover:bg-brass/10">
              <ImageIcon className="h-4 w-4" /> <Video className="h-4 w-4" /> Subir imagen o video
              <input type="file" accept="image/*,video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void addMedia(f); }} />
            </label>
          </div>

          <label className="flex items-start gap-3 rounded-xl border border-brass/40 bg-brass/5 p-3 text-sm">
            <Switch checked={site.showSocialHero} onCheckedChange={(c) => set("showSocialHero", c)} />
            <span><b>Mostrar la comunidad en el inicio</b> — activa los perfiles tipo red social para todo el público: fotos, videos, reseñas y puntajes de tus barberos directamente en el hero.</span>
          </label>
        </div>
      </SettingsCard>

      {/* ============================== SECCIONES ============================== */}
      <SettingsCard icon={<ListChecks className="h-5 w-5" />} title="Secciones y textos del sitio" desc="Enciende o apaga secciones y edita sus títulos.">
        <div className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <ToggleField label="Sección de servicios" checked={site.showServicesSection} onChange={(c) => set("showServicesSection", c)} />
            <ToggleField label="Sección de equipo" checked={site.showTeamSection} onChange={(c) => set("showTeamSection", c)} />
            <ToggleField label="Sección de reserva" checked={site.showBookingSection} onChange={(c) => set("showBookingSection", c)} />
            <ToggleField label="Preguntas frecuentes" checked={site.showFaqSection} onChange={(c) => set("showFaqSection", c)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1"><Label>Título de servicios</Label><Input value={site.servicesTitle} onChange={(e) => set("servicesTitle", e.target.value)} /></div>
            <div className="grid gap-1"><Label>Subtítulo de servicios</Label><Input value={site.servicesSubtitle} onChange={(e) => set("servicesSubtitle", e.target.value)} /></div>
            <div className="grid gap-1"><Label>Título de equipo</Label><Input value={site.teamTitle} onChange={(e) => set("teamTitle", e.target.value)} /></div>
            <div className="grid gap-1"><Label>Subtítulo de equipo</Label><Input value={site.teamSubtitle} onChange={(e) => set("teamSubtitle", e.target.value)} /></div>
            <div className="grid gap-1"><Label>Título de la reserva</Label><Input value={site.bookingTitle} onChange={(e) => set("bookingTitle", e.target.value)} /></div>
            <div className="grid gap-1"><Label>Subtítulo de la reserva</Label><Input value={site.bookingSubtitle} onChange={(e) => set("bookingSubtitle", e.target.value)} /></div>
            <div className="grid gap-1"><Label>Título de preguntas frecuentes</Label><Input value={site.faqTitle} onChange={(e) => set("faqTitle", e.target.value)} /></div>
            <div className="grid gap-1"><Label>Subtítulo de preguntas</Label><Input value={site.faqSubtitle} onChange={(e) => set("faqSubtitle", e.target.value)} /></div>
          </div>

          <div className="rounded-xl border border-ink/10 bg-cream p-4">
            <Label>Preguntas frecuentes</Label>
            <p className="mb-2 text-xs text-ink-soft">Mínimo recomendado: 5 preguntas. Se muestran en acordeón, una abierta a la vez.</p>
            {site.faq.map((item, i) => (
              <div key={i} className="mb-3 grid gap-2 rounded-xl border border-ink/10 bg-ivory p-3">
                <Input
                  value={item.q}
                  placeholder="Pregunta"
                  onChange={(e) => set("faq", site.faq.map((f, idx) => (idx === i ? { ...f, q: e.target.value } : f)))}
                />
                <Textarea
                  rows={2} value={item.a} placeholder="Respuesta"
                  onChange={(e) => set("faq", site.faq.map((f, idx) => (idx === i ? { ...f, a: e.target.value } : f)))}
                />
                <Button variant="ghost" size="sm" className="justify-self-start text-melo-dark" onClick={() => set("faq", site.faq.filter((_, idx) => idx !== i))}>
                  <Trash2 className="mr-1 h-3 w-3" /> Quitar pregunta
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" className="border-brass/50 text-brass-dark" onClick={() => set("faq", [...site.faq, { q: "", a: "" }])}>
              <Plus className="h-4 w-4" /> Agregar pregunta
            </Button>
          </div>
        </div>
      </SettingsCard>

      {/* ============================== MEMBRETE / CONTACTO ============================== */}
      <SettingsCard icon={<MessageCircle className="h-5 w-5" />} title="Membrete inferior y contacto" desc="Los datos que ven los clientes al final del sitio. Aquí también va tu número de WhatsApp: allí te llegan los resúmenes de reserva.">
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1"><Label>Nombre del negocio</Label><Input value={site.businessName} onChange={(e) => set("businessName", e.target.value)} /></div>
            <div className="grid gap-1"><Label>Frase del membrete</Label><Input value={site.footerTagline} onChange={(e) => set("footerTagline", e.target.value)} /></div>
            <div className="grid gap-1"><Label>Teléfono visible</Label><Input value={site.footerPhone} onChange={(e) => set("footerPhone", e.target.value)} placeholder="+57 …" /></div>
            <div className="grid gap-1"><Label>Dirección</Label><Input value={site.footerAddress} onChange={(e) => set("footerAddress", e.target.value)} /></div>
            <div className="grid gap-1"><Label>Correo (opcional)</Label><Input value={site.footerEmail} onChange={(e) => set("footerEmail", e.target.value)} placeholder="dejar vacío para no mostrarlo" /></div>
            <div className="grid gap-1">
              <Label>Mi WhatsApp (llegan las reservas)</Label>
              <Input
                value={site.footerWhatsapp}
                onChange={(e) => set("footerWhatsapp", e.target.value)}
                placeholder="573213672594"
                className="font-mono"
              />
              <p className="text-xs text-ink-soft">Con código de país, sin espacios ni símbolos. Ejemplo: 573213672594</p>
            </div>
            <div className="grid gap-1"><Label>Instagram (opcional)</Label><Input value={site.socialInstagram} onChange={(e) => set("socialInstagram", e.target.value)} placeholder="https://instagram.com/…" /></div>
            <div className="grid gap-1"><Label>Facebook (opcional)</Label><Input value={site.socialFacebook} onChange={(e) => set("socialFacebook", e.target.value)} placeholder="https://facebook.com/…" /></div>
            <div className="grid gap-1"><Label>TikTok (opcional)</Label><Input value={site.socialTiktok} onChange={(e) => set("socialTiktok", e.target.value)} placeholder="https://tiktok.com/@…" /></div>
          </div>

          <div className="rounded-xl border border-ink/10 bg-cream p-4">
            <Label>Horario del membrete</Label>
            <p className="mb-2 text-xs text-ink-soft">Una línea por dato, igual que en el pie del sitio.</p>
            {site.footerHours.map((line, i) => (
              <div key={i} className="mb-2 flex gap-2">
                <Input value={line} onChange={(e) => set("footerHours", site.footerHours.map((l, idx) => (idx === i ? e.target.value : l)))} />
                <Button variant="ghost" size="icon" className="text-melo-dark" onClick={() => set("footerHours", site.footerHours.filter((_, idx) => idx !== i))} aria-label="Quitar">×</Button>
              </div>
            ))}
            <Button variant="outline" size="sm" className="border-brass/50 text-brass-dark" onClick={() => set("footerHours", [...site.footerHours, ""])}><Plus className="h-4 w-4" /> Agregar línea</Button>
          </div>
        </div>
      </SettingsCard>

      {/* ============================== NOTIFICACIONES ============================== */}
      <SettingsCard icon={<BellRing className="h-5 w-5" />} title="Notificaciones y sonidos" desc="Cuando un cliente reserve, te llega una notificación sobre cualquier pantalla del dispositivo (también smartphones). Elige el sonido y qué eventos te avisan.">
        <div className="grid gap-4">
          <div className={cn(
            "flex flex-wrap items-center gap-3 rounded-xl border p-4",
            perm === "granted" ? "border-good/40 bg-good/5" : perm === "denied" ? "border-melo/40 bg-melo/10" : "border-warn/40 bg-warn/5"
          )}>
            {perm === "granted" ? <BellRing className="h-6 w-6 text-good" /> : perm === "denied" ? <ShieldAlert className="h-6 w-6 text-melo-dark" /> : <Smartphone className="h-6 w-6 text-warn" />}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">
                {perm === "granted" ? "Notificaciones activadas en este dispositivo ✔" : perm === "denied" ? "Notificaciones bloqueadas en este dispositivo" : "Notificaciones sin activar"}
              </div>
              <div className="text-xs text-ink-soft">
                {perm === "denied"
                  ? "Desbloquéalas desde el candado de la barra de direcciones. El sistema te lo seguirá recordando en otros dispositivos."
                  : "El sistema pide activarlas mientras no estén concedidas; al activarlas dejan de pedirse."}
              </div>
            </div>
            {perm !== "granted" ? (
              <Button
                size="sm" className="bg-ink text-ivory"
                onClick={async () => {
                  const { requestPermission } = await import("@/lib/notify-client");
                  const r = await requestPermission();
                  setPerm(r);
                  toast({ title: r === "granted" ? "Notificaciones activadas" : "Aún no se activan", description: r === "granted" ? "Te avisaremos de cada reserva." : undefined });
                }}
              >
                Activar
              </Button>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-ink/10 bg-cream p-4">
              <Label className="mb-2 block"><Volume2 className="mr-1 inline h-4 w-4" /> Sonido de notificación</Label>
              <div className="grid gap-2">
                {SOUNDS.map((s) => (
                  <label key={s.id} className="flex cursor-pointer items-center justify-between rounded-lg border border-ink/10 bg-ivory px-3 py-2 text-sm">
                    <span className={cn("font-medium", notif.sound === s.id && "text-brass-dark")}>{s.label}</span>
                    <span className="flex items-center gap-2">
                      <button
                        type="button"
                        className="rounded-full border border-brass/40 px-2 py-0.5 text-xs text-brass-dark hover:bg-brass/10"
                        onClick={(e) => { e.preventDefault(); playPreviewSound(s.id); }}
                      >
                        Probar
                      </button>
                      <input type="radio" name="sound" checked={notif.sound === s.id} onChange={() => { setN("sound", s.id); playPreviewSound(s.id); }} />
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid content-start gap-2">
              <label className="flex items-center gap-3 rounded-xl border border-ink/10 bg-cream p-3 text-sm">
                <Switch checked={notif.vibrate} onCheckedChange={(c) => setN("vibrate", c)} />
                Vibrar al notificar (si el dispositivo lo soporta)
              </label>
              <div className="rounded-xl border border-ink/10 bg-cream p-3">
                <Label className="mb-2 block">¿Qué eventos te avisan?</Label>
                <div className="grid gap-2">
                  <ToggleField compact label="🔔 Nueva reserva" checked={notif.notifyOnBooking} onChange={(c) => setN("notifyOnBooking", c)} />
                  <ToggleField compact label="❌ Cancelaciones" checked={notif.notifyOnCancel} onChange={(c) => setN("notifyOnCancel", c)} />
                  <ToggleField compact label="💰 Pagos registrados" checked={notif.notifyOnPayment} onChange={(c) => setN("notifyOnPayment", c)} />
                  <ToggleField compact label="✂️ Servicios completados" checked={notif.notifyOnComplete} onChange={(c) => setN("notifyOnComplete", c)} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </SettingsCard>

      <div className="mt-4 flex justify-end">
        <Button onClick={save} disabled={busy} size="lg" className="bg-good hover:bg-good/85 text-ivory">
          <Save className="mr-1 h-4 w-4" /> {busy ? "Guardando…" : "Guardar todo"}
        </Button>
      </div>
    </div>
  );
}

// ============================================================ PERFIL DEL ADMIN (premium "Ronald")
function OwnerProfileCard({ profile, setP }: { profile: OwnerProfile; setP: <K extends keyof OwnerProfile>(k: K, v: OwnerProfile[K]) => void }) {
  const premium = isOwnerPremium(profile);
  const db = getDB();
  const autoXP = ownerAutoXP(db);
  const xp = premium && profile.manualXP ? profile.xpOverride : autoXP;
  const lvl = premium && profile.levelOverride
    ? { current: LEVELS.find((l) => l.name === profile.levelOverride) ?? LEVELS[0], next: null, progress: 100 }
    : barberLevel(xp);

  return (
    <div className={cn(
      "mb-4 rounded-2xl border p-5",
      premium ? "border-brass/60 bg-gradient-to-r from-brass/15 to-ivory" : "border-ink/10 bg-ivory"
    )}>
      <div className="mb-1 flex flex-wrap items-center gap-2 font-display text-lg font-bold text-ink">
        <User className="h-5 w-5" /> Mi perfil
        {premium ? (
          <Chip className="border-brass/60 bg-brass/20 text-brass-dark"><Crown className="mr-1 h-3.5 w-3.5" /> Premium activo</Chip>
        ) : null}
      </div>
      <p className="mb-4 text-sm text-ink-soft">Tu nombre de administrador y tu progreso como barbero de la casa.</p>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* identidad + roadmap */}
        <div className="grid content-start gap-3">
          <div className="grid gap-1">
            <Label htmlFor="owner-name">Nombre del administrador</Label>
            <Input
              id="owner-name"
              value={profile.name}
              onChange={(e) => setP("name", e.target.value)}
              placeholder="Tu nombre"
            />
          </div>
          <div className="rounded-2xl border border-brass/40 bg-cream p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-4xl">{lvl.current.icon}</span>
                <div>
                  <div className="text-xs uppercase tracking-wide text-ink-soft">Tu nivel</div>
                  <div className="font-display text-2xl font-bold">{lvl.current.name}</div>
                </div>
              </div>
              <Chip className="border-brass/40 text-brass-dark"><Zap className="h-3.5 w-3.5" /> {xp} XP</Chip>
            </div>
            <div className="mt-3">
              <div className="mb-1 flex justify-between text-xs text-ink-soft">
                <span>{lvl.current.name}</span>
                <span>
                  {profile.levelOverride && premium
                    ? "Rango fijado manualmente"
                    : lvl.next
                      ? `${xp}/${lvl.next.min} XP para ${lvl.next.name} ${lvl.next.icon}`
                      : "¡Nivel máximo alcanzado! 👑"}
                </span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-ink/10">
                <div className="h-full rounded-full bg-gradient-to-r from-brass to-melo transition-all" style={{ width: `${lvl.progress}%` }} />
              </div>
            </div>
          </div>
        </div>

        {/* premium */}
        <div className={cn("rounded-2xl border p-4", premium ? "border-brass/50 bg-ivory" : "border-ink/10 bg-cream")}>
          <div className="flex items-center gap-2 font-semibold text-sm">
            {premium ? <Crown className="h-4 w-4 text-brass-dark" /> : <Lock className="h-4 w-4 text-ink-soft" />}
            Control de experiencia y rango
            {premium ? null : <Chip className="ml-auto border-ink/15 text-ink-soft">Bloqueado</Chip>}
          </div>

          {premium ? (
            <div className="mt-3 grid gap-3">
              <ToggleField
                label={<span>Controlar mi XP manualmente <span className="text-ink-soft">(si lo apagas, cuenta los servicios completados de la barbería)</span></span>}
                checked={profile.manualXP}
                onChange={(c) => setP("manualXP", c)}
              />
              {profile.manualXP ? (
                <div className="grid gap-1">
                  <Label htmlFor="owner-xp">Mi XP</Label>
                  <div className="flex gap-2">
                    <Input
                      id="owner-xp"
                      type="number"
                      min={0}
                      value={profile.xpOverride}
                      onChange={(e) => setP("xpOverride", Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                    />
                    {[10, 50].map((n) => (
                      <Button key={n} variant="outline" onClick={() => setP("xpOverride", profile.xpOverride + n)}>+{n}</Button>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="rounded-lg bg-cream px-3 py-2 text-xs text-ink-soft">
                  XP automático: <b>{autoXP}</b> (servicios completados en tu barbería)
                </p>
              )}

              <div className="grid gap-1">
                <Label>Mi rango</Label>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setP("levelOverride", null)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                      profile.levelOverride === null ? "border-ink bg-ink text-ivory" : "border-ink/15 bg-ivory text-ink-soft hover:bg-cream"
                    )}
                  >
                    Automático
                  </button>
                  {LEVELS.map((l) => (
                    <button
                      key={l.name}
                      onClick={() => setP("levelOverride", l.name)}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                        profile.levelOverride === l.name ? "border-brass bg-brass/20 text-brass-dark" : "border-ink/15 bg-ivory text-ink-soft hover:bg-cream"
                      )}
                    >
                      {l.icon} {l.name}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-ink-soft">«Automático» sigue tu XP; elegir un rango lo fija siempre.</p>
              </div>
            </div>
          ) : (
            <p className="mt-3 rounded-lg border border-dashed border-ink/20 px-3 py-3 text-sm text-ink-soft">
              Tu nivel y XP evolucionan solos con los servicios completados de la barbería. El control manual está reservado
              para el administrador <b>Ronald</b>.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsCard({ icon, title, desc, children }: { icon: React.ReactNode; title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 rounded-2xl border border-ink/10 bg-ivory p-5">
      <div className="mb-1 flex items-center gap-2 font-display text-lg font-bold text-ink">{icon} {title}</div>
      <p className="mb-4 text-sm text-ink-soft">{desc}</p>
      {children}
    </div>
  );
}

function ToggleField({ label, checked, onChange, compact }: { label: React.ReactNode; checked: boolean; onChange: (c: boolean) => void; compact?: boolean }) {
  return (
    <label className={cn("flex items-center gap-3 text-sm", compact ? "" : "rounded-xl border border-ink/10 bg-cream p-3")}>
      <Switch checked={checked} onCheckedChange={onChange} />
      {label}
    </label>
  );
}
