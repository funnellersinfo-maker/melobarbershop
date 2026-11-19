"use client";
// Página pública de MELO BARBERSHOP: contenido editable desde el panel del dueño
// (hero con imagen/video/carrusel, horarios, membrete, FAQ) + wizard de reserva
// que envía el resumen al WhatsApp del negocio + perfiles públicos de barberos.
import { useEffect, useMemo, useState } from "react";
import { getAdminData, getDB, deviceId, type Barber, type Service, type Post, type Comment } from "@/lib/store";
import { cop } from "@/lib/money";
import { DIAS_CORTOS, MESES_CORTOS, dateKeyInBogota, partsInBogota, addDaysKey } from "@/lib/time";
import { BrandLockup, PoleStripe, Chip, Logo, SectionTitle, useMeloDB } from "@/components/melo/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  Scissors, CalendarDays, Clock, CheckCircle2, ChevronLeft, ChevronRight, Sparkles,
  Phone, MapPin, Settings, Star, Heart, MessageCircle, Play, ChevronDown, Send,
} from "lucide-react";

// ============================================================ WIZARD
type Slot = { time: string; startMin: number; barbers: string[] };

function nextDays(count: number): string[] {
  const today = dateKeyInBogota(new Date());
  return Array.from({ length: count }, (_, i) => addDaysKey(today, i));
}

function dayLabel(key: string): { dow: string; day: string; month: string } {
  const d = new Date(`${key}T12:00:00-05:00`);
  const p = partsInBogota(d);
  return { dow: DIAS_CORTOS[p.dow], day: String(p.day), month: MESES_CORTOS[p.month - 1] };
}

/** Resumen listo para WhatsApp en texto plano: sin emojis, así nunca llegan
 * símbolos rotos (rombos negros) en ningún teléfono ni versión de WhatsApp. */
function buildWhatsappMessage(p: {
  service: Service; barberName: string; date: string; time: string; clientName: string; clientPhone: string; code: string;
}): string {
  const lines = [
    "*MELO BARBERSHOP - NUEVA CITA*",
    "",
    `*Cliente:* ${p.clientName}`,
    p.clientPhone ? `*Telefono:* ${p.clientPhone}` : null,
    `*Servicio:* ${p.service.name}`,
    `*Valor:* $${p.service.price.toLocaleString("es-CO")}`,
    `*Duracion:* ${p.service.durationMin} minutos`,
    `*Barbero:* ${p.barberName}`,
    `*Fecha:* ${p.date}`,
    `*Hora:* ${p.time}`,
    `*Codigo de cita:* ${p.code}`,
    "",
    "Por favor confirma mi cita. Gracias!",
  ].filter(Boolean);
  return lines.join("\n");
}

function BookingWizard({ onHome }: { onHome: () => void }) {
  const [step, setStep] = useState(1);
  const tick = useMeloDB(); // reacciona al instante si el dueño guarda barberos/servicios mientras el cliente elige
  const db = getDB();
  const admin = getAdminData();
  const services = useMemo(() => db.services.filter((s) => s.active), [tick, db.services.length]);
  const barbers = useMemo(() => db.barbers.filter((b) => b.active), [tick, db.barbers.length]);

  const [serviceId, setServiceId] = useState<string | null>(null);
  const [barberChoice, setBarberChoice] = useState<string>("ANY");
  const [date, setDate] = useState<string>(dateKeyInBogota(new Date()));
  const [time, setTime] = useState<string | null>(null);
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [sent, setSent] = useState(false);

  const days = useMemo(() => nextDays(21), [tick]); // si cambia la disponibilidad, los días se reevalúan
  const service = services.find((s) => s.id === serviceId) ?? null;

  // Si el dueño desactivó/eliminó el servicio elegido mientras el cliente reservaba, se vuelve al paso 1
  useEffect(() => {
    if (serviceId && !service) {
      setServiceId(null);
      setStep(1);
    }
  }, [serviceId, service]);

  // Si la hora elegida dejó de ser válida tras un cambio en vivo (duración, intervalo, horarios), se re-selecciona.
  // Nunca después de confirmar (sent): la propia reserva bloquea esa hora y el usuario debe ver el paso 5.
  useEffect(() => {
    if (!sent && step >= 4 && time && !slots.some((s) => s.time === time)) {
      setTime(null);
      setStep(3);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const slots = useMemo<Slot[]>(() => {
    if (!serviceId) return [];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { slotsForService } = require("@/lib/engines/booking") as typeof import("@/lib/engines/booking");
    return slotsForService(getDB(), serviceId, date, barberChoice);
    // tick: si el dueño cambia duración, intervalo entre cortes o rango de horas, los slots se recalculan al instante
  }, [serviceId, date, barberChoice, step, tick]);

  // helpers de slots por barbero (se recalculan al cambiar selección)
  function slotsFor(choice: string): Slot[] {
    if (!serviceId) return [];
    const { slotsForService } = require("@/lib/engines/booking") as typeof import("@/lib/engines/booking");
    return slotsForService(getDB(), serviceId, date, choice);
  }

  const result = useMemo(() => {
    if (!sent || !service || !time) return null;
    return { code: (window as unknown as { __meloLastCode?: string }).__meloLastCode ?? "" };
  }, [sent, service, time]);

  function confirmAndSend() {
    if (!service || !time) return;
    const { createAppointment } = require("@/lib/engines/booking") as typeof import("@/lib/engines/booking");
    const barberName =
      barberChoice === "ANY"
        ? "El primero disponible"
        : barbers.find((b) => b.id === barberChoice)?.name ?? "El primero disponible";
    let code = "";
    try {
      const appt = createAppointment({
        barberId: barberChoice,
        serviceId: service.id,
        dateKey: date,
        startMin: slots.find((s) => s.time === time)?.startMin ?? 0,
        clientName,
        clientPhone: clientPhone || null,
        origin: "PUBLIC",
        createdByName: "Reserva web",
      });
      code = appt.code;
      (window as unknown as { __meloLastCode?: string }).__meloLastCode = code;
    } catch {
      /* si falla la reserva local, igual enviamos el resumen por WhatsApp */
    }
    const msg = buildWhatsappMessage({
      service,
      barberName: barberChoice === "ANY" ? "Cualquiera disponible" : barberName,
      date,
      time,
      clientName,
      clientPhone,
      code,
    });
    const phone = admin.site.footerWhatsapp.replace(/\D/g, "");
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
    setSent(true);
    setStep(5);
  }

  function reset() {
    setStep(1); setServiceId(null); setBarberChoice("ANY"); setTime(null);
    setClientName(""); setClientPhone(""); setSent(false);
  }

  const stepTitles = ["Servicio", "Barbero", "Fecha y hora", "Tus datos", "Listo"];

  return (
    <div className="rounded-3xl border border-ink/10 bg-ivory p-6 shadow-sm md:p-8">
      <ol className="mb-6 flex items-center gap-2 text-xs">
        {stepTitles.map((t, i) => {
          const n = i + 1;
          const active = step === n;
          const done = step > n;
          return (
            <li key={t} className="flex items-center gap-2">
              <span className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-bold",
                done ? "border-good bg-good text-ivory" : active ? "border-melo bg-melo text-ivory" : "border-ink/20 text-ink/50"
              )}>
                {done ? <CheckCircle2 className="h-4 w-4" /> : n}
              </span>
              <span className={cn("hidden sm:inline", active ? "font-semibold text-ink" : "text-ink/50")}>{t}</span>
              {n < 5 ? <span className="mx-1 h-px w-4 bg-ink/20 sm:w-8" /> : null}
            </li>
          );
        })}
      </ol>

      {step === 1 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {services.map((s) => (
            <button
              key={s.id}
              onClick={() => { setServiceId(s.id); setStep(2); }}
              className="rounded-2xl border border-ink/15 bg-ivory p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex justify-between gap-2 font-semibold">{s.name} <span className="text-melo">{cop(s.price)}</span></div>
              <div className="mt-1 text-sm text-ink-soft">{s.durationMin} min · {s.description}</div>
            </button>
          ))}
        </div>
      ) : null}

      {step === 2 && service ? (
        <div>
          <div className="mb-3 text-sm text-ink-soft">Servicio elegido: <b className="text-ink">{service.name}</b> · {cop(service.price)} · {service.durationMin} min</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              onClick={() => { setBarberChoice("ANY"); setStep(3); }}
              className="rounded-2xl border border-brass/50 bg-brass/10 p-4 text-left hover:shadow-md"
            >
              <div className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-brass-dark" /> Cualquier barbero</div>
              <div className="mt-1 text-sm text-ink-soft">Asignamos el primer barbero disponible.</div>
            </button>
            {barbers.map((b) => (
              <button
                key={b.id}
                onClick={() => { setBarberChoice(b.id); setStep(3); }}
                className="flex items-center gap-3 rounded-2xl border border-ink/15 bg-ivory p-4 text-left hover:shadow-md"
              >
                {b.photo ? (
                  <img src={b.photo} alt={b.name} className="h-11 w-11 rounded-full object-cover ring-2 ring-brass/40" />
                ) : (
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brass/15 font-display font-bold text-brass-dark">
                    {b.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                  </span>
                )}
                <span>
                  <span className="block font-semibold">{b.name}</span>
                  <span className="text-sm text-ink-soft">{b.specialty || "Barbero profesional"}</span>
                </span>
              </button>
            ))}
          </div>
          <StepBack onClick={() => setStep(1)} />
        </div>
      ) : null}

      {step === 3 && service ? (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm text-ink-soft">Elige el día:</div>
          </div>
          <div className="mb-5 flex gap-2 overflow-x-auto pb-2 nice-scroll">
            {days.map((k) => {
              const l = dayLabel(k);
              const selected = k === date;
              return (
                <button
                  key={k}
                  onClick={() => setDate(k)}
                  className={cn(
                    "min-w-16 rounded-xl border px-3 py-2 text-center transition",
                    selected ? "border-melo bg-melo text-ivory" : "border-ink/15 bg-ivory hover:border-brass"
                  )}
                >
                  <div className="text-[10px] uppercase opacity-70">{l.dow}</div>
                  <div className="font-display text-xl font-bold">{l.day}</div>
                  <div className="text-[10px] opacity-70">{l.month}</div>
                </button>
              );
            })}
          </div>
          {slots.length === 0 ? (
            <div className="rounded-xl border border-dashed border-ink/20 bg-cream px-4 py-8 text-center text-ink-soft">
              No hay horarios disponibles para este día con esta selección. Prueba otro día u otro barbero.
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {slots.map((s) => (
                <button
                  key={s.time}
                  onClick={() => { setTime(s.time); setStep(4); }}
                  className={cn(
                    "rounded-lg border py-2 text-sm font-medium tabular-nums transition",
                    time === s.time ? "border-melo bg-melo text-ivory" : "border-ink/15 bg-ivory hover:border-brass hover:bg-brass/10"
                  )}
                >
                  {s.time}
                </button>
              ))}
            </div>
          )}
          <StepBack onClick={() => setStep(2)} />
        </div>
      ) : null}

      {step === 4 && service && time ? (
        <div className="mx-auto max-w-md">
          <div className="mb-4 rounded-xl bg-cream p-4 text-sm">
            <div className="font-semibold">{service.name} · {cop(service.price)}</div>
            <div className="mt-1 text-ink-soft">
              {barberChoice === "ANY" ? "Cualquier barbero disponible" : barbers.find((b) => b.id === barberChoice)?.name} ·{" "}
              {date} a las {time} · {service.durationMin} min
            </div>
          </div>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="r-name">Nombre completo *</Label>
              <Input id="r-name" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Ej: María Gómez" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="r-phone">WhatsApp / teléfono (opcional)</Label>
              <Input id="r-phone" inputMode="tel" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} placeholder="+57 300 000 0000" />
            </div>
          </div>
          <div className="mt-6 flex items-center justify-between">
            <StepBack onClick={() => setStep(3)} bare />
            <Button disabled={clientName.trim().length < 2} onClick={confirmAndSend} className="bg-[#25D366] px-6 text-ink hover:bg-[#1fb857]">
              <Send className="mr-2 h-4 w-4" /> Confirmar cita por WhatsApp
            </Button>
          </div>
        </div>
      ) : null}

      {step === 5 && result ? (
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-good/15">
            <CheckCircle2 className="h-9 w-9 text-good" />
          </div>
          <h3 className="font-display text-2xl font-bold">¡Tu cita quedó agendada!</h3>
          {result.code ? (
            <p className="mt-2 text-ink-soft">Tu código de cita es <b className="font-display tracking-widest text-melo">{result.code}</b>. Guárdalo para cambios o cancelaciones.</p>
          ) : (
            <p className="mt-2 text-ink-soft">Te esperamos puntual.</p>
          )}
          <p className="mt-1 text-sm text-ink-soft">Si no se abrió WhatsApp, revisa que tu navegador permita ventanas emergentes.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button variant="outline" className="border-ink/25" onClick={reset}>Reservar otra cita</Button>
            <Button variant="outline" className="border-ink/25" onClick={onHome}>Volver al inicio</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StepBack({ onClick, bare = false }: { onClick: () => void; bare?: boolean }) {
  if (bare) return null;
  return (
    <button onClick={onClick} className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-ink-soft hover:text-ink">
      <ChevronLeft className="h-4 w-4" /> Volver
    </button>
  );
}

// ============================================================ CARRUSEL HERO
function HeroCarousel({ items }: { items: Array<{ src: string; src2?: string; src3?: string }> }) {
  const [idx, setIdx] = useState(0);
  const all = useMemo(() => {
    const out: string[] = [];
    for (const it of items) {
      out.push(it.src);
      if (it.src2) out.push(it.src2);
      if (it.src3) out.push(it.src3);
    }
    return out;
  }, [items]);
  useEffect(() => {
    if (all.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % all.length), 3500);
    return () => clearInterval(t);
  }, [all.length]);
  if (all.length === 0) return null;
  return (
    <div className="relative mx-auto h-72 w-72 md:h-80 md:w-80">
      {all.map((src, i) => (
        <img
          key={`${src.slice(-24)}-${i}`}
          src={src}
          alt={`Trabajo de MELO BARBERSHOP ${i + 1}`}
          loading="lazy"
          className={cn(
            "absolute inset-0 h-full w-full rounded-3xl border-8 border-ivory object-cover shadow-xl transition-opacity duration-700",
            i === idx ? "opacity-100" : "opacity-0"
          )}
        />
      ))}
      {all.length > 1 ? (
        <>
          <button onClick={() => setIdx((i) => (i - 1 + all.length) % all.length)} aria-label="Anterior"
            className="absolute -left-3 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-ivory/90 shadow">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button onClick={() => setIdx((i) => (i + 1) % all.length)} aria-label="Siguiente"
            className="absolute -right-3 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-ivory/90 shadow">
            <ChevronRight className="h-5 w-5" />
          </button>
          <div className="absolute -bottom-3 left-1/2 z-10 flex -translate-x-1/2 gap-1.5">
            {all.map((_, i) => (
              <button key={i} onClick={() => setIdx(i)} aria-label={`Ir a ${i + 1}`}
                className={cn("h-2 w-2 rounded-full transition", i === idx ? "bg-ink" : "bg-ink/25")} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function HeroMediaBlock() {
  const admin = getAdminData();
  const mode = admin.site.heroMediaMode;
  const media = admin.site.heroMedia;
  if (mode === "VIDEO" && media[0]?.src) {
    return (
      <div className="relative mx-auto hidden md:block">
        <video
          src={media[0].src}
          className="h-72 w-80 rounded-3xl border-8 border-ivory object-cover shadow-xl"
          autoPlay muted loop playsInline preload="none" poster="/melo-logo.png"
          aria-label="Video de MELO BARBERSHOP"
        />
        <div className="pole absolute -right-2 top-8 h-56 w-5 rounded-full shadow-md" aria-hidden />
      </div>
    );
  }
  if ((mode === "IMAGE" || mode === "CAROUSEL") && media.length > 0) {
    return (
      <div className="relative mx-auto hidden md:block">
        <HeroCarousel items={media} />
        <div className="pole absolute -right-2 top-8 h-56 w-5 rounded-full shadow-md" aria-hidden />
      </div>
    );
  }
  return (
    <div className="relative mx-auto hidden md:block">
      <img
        src="/melo-logo.png"
        alt="MELO BARBERSHOP"
        className="mx-auto h-64 w-64 rounded-3xl border-8 border-ivory object-cover shadow-xl"
      />
      <div className="pole absolute -right-2 top-8 h-56 w-5 rounded-full shadow-md" aria-hidden />
    </div>
  );
}

// ============================================================ PERFIL PÚBLICO DE BARBERO
function BarberPublicProfile({ barber, onBack }: { barber: Barber; onBack: () => void }) {
  const [, force] = useState(0);
  const db = getDB();
  const posts = db.posts.filter((p) => p.barberId === barber.id && !p.hidden);
  const reviews = db.comments.filter((c) => c.barberId === barber.id && c.postId === null && !c.hidden && c.rating);
  const avg = reviews.length ? reviews.reduce((s, c) => s + (c.rating ?? 0), 0) / reviews.length : 0;
  const stars = avg ? Math.round(avg * 10) / 10 : 0;
  const dev = deviceId();

  function toggleLike(post: Post) {
    const { mutateDB } = require("@/lib/store") as typeof import("@/lib/store");
    mutateDB((d) => {
      const p = d.posts.find((x) => x.id === post.id);
      if (!p) return;
      const i = p.likes.indexOf(dev);
      if (i >= 0) p.likes.splice(i, 1);
      else p.likes.push(dev);
    });
    force((n) => n + 1);
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-cream/98 backdrop-blur-sm">
      <div className="mx-auto max-w-3xl px-4 py-6">
        <button onClick={onBack} className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-ink-soft hover:text-ink">
          <ChevronLeft className="h-4 w-4" /> Volver a la reserva
        </button>

        {/* cabecera del perfil */}
        <div className="rounded-3xl border border-ink/10 bg-ivory p-6 shadow-sm">
          <div className="flex flex-wrap items-center gap-5">
            {barber.photo ? (
              <img src={barber.photo} alt={barber.name} className="h-24 w-24 rounded-2xl object-cover ring-4 ring-brass/30" />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-brass/15 font-display text-3xl font-bold text-brass-dark">
                {barber.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-2xl font-bold">{barber.name}</h3>
              <div className="text-sm text-ink-soft">{barber.specialty || "Barbero profesional"}</div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-1 rounded-full border border-brass/40 bg-brass/10 px-3 py-1 text-sm font-semibold text-brass-dark">
                  <Star className="h-4 w-4 fill-brass text-brass" /> {stars || "—"} / 5
                </span>
                <span className="text-sm text-ink-soft">{reviews.length} reseña(s)</span>
                <span className="text-sm text-ink-soft">❤️ {posts.reduce((s, p) => s + p.likes.length, 0)} me gusta</span>
              </div>
            </div>
          </div>
          {barber.bio ? <p className="mt-4 text-sm leading-relaxed text-ink-soft">{barber.bio}</p> : null}
        </div>

        {/* publicaciones */}
        <div className="mt-6">
          <h4 className="mb-3 font-display text-xl font-bold">Sus trabajos</h4>
          {posts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-ink/15 bg-ivory/60 px-6 py-10 text-center text-sm text-ink-soft">
              Aún no hay publicaciones. ¡Vuelve pronto!
            </div>
          ) : (
            <div className="grid gap-4">
              {posts.map((post) => (
                <div key={post.id} className="overflow-hidden rounded-2xl border border-ink/10 bg-ivory shadow-sm">
                  {post.media[0]?.type === "VIDEO" ? (
                    <video src={post.media[0].src} controls playsInline preload="none" className="max-h-96 w-full bg-ink object-contain" />
                  ) : post.media[0] ? (
                    <img src={post.media[0].src} alt={post.caption || "Trabajo de barbería"} loading="lazy" className="max-h-96 w-full object-cover" />
                  ) : null}
                  <div className="p-4">
                    {post.caption ? <p className="text-sm text-ink">{post.caption}</p> : null}
                    <div className="mt-3 flex items-center gap-4">
                      <button
                        onClick={() => toggleLike(post)}
                        className={cn("inline-flex items-center gap-1.5 text-sm font-medium transition", post.likes.includes(dev) ? "text-melo" : "text-ink-soft hover:text-melo")}
                        aria-label="Me gusta"
                      >
                        <Heart className={cn("h-5 w-5", post.likes.includes(dev) && "fill-melo")} /> {post.likes.length}
                      </button>
                      <span className="inline-flex items-center gap-1.5 text-sm text-ink-soft">
                        <MessageCircle className="h-4 w-4" /> {db.comments.filter((c) => c.postId === post.id && !c.hidden).length}
                      </span>
                    </div>
                    <PostComments post={post} onReload={() => force((n) => n + 1)} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* reseñas */}
        <div className="mt-6">
          <h4 className="mb-3 font-display text-xl font-bold">Reseñas ({reviews.length})</h4>
          <ReviewForm barberId={barber.id} onDone={() => force((n) => n + 1)} />
          <div className="mt-4 grid gap-3">
            {reviews.slice(0, 20).map((c) => (
              <div key={c.id} className="rounded-2xl border border-ink/10 bg-ivory p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{c.authorName}</span>
                  <span className="inline-flex items-center gap-0.5">
                    {Array.from({ length: 5 }, (_, i) => (
                      <Star key={i} className={cn("h-3.5 w-3.5", i < (c.rating ?? 0) ? "fill-brass text-brass" : "text-ink/20")} />
                    ))}
                  </span>
                </div>
                {c.text ? <p className="mt-1 text-sm text-ink-soft">{c.text}</p> : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function PostComments({ post, onReload }: { post: Post; onReload: () => void }) {
  const db = getDB();
  const comments = db.comments.filter((c) => c.postId === post.id && !c.hidden);
  const [text, setText] = useState("");
  const [name, setName] = useState("");

  function send() {
    if (!text.trim()) return;
    const { mutateDB } = require("@/lib/store") as typeof import("@/lib/store");
    mutateDB((d) => {
      d.comments.push({
        id: `cmt-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
        postId: post.id,
        barberId: post.barberId,
        authorName: name.trim() || "Cliente",
        deviceId: deviceId(),
        rating: null,
        text: text.trim().slice(0, 400),
        createdAt: new Date().toISOString(),
      });
    });
    setText("");
    onReload();
  }

  return (
    <div className="mt-3 border-t border-ink/10 pt-3">
      {comments.length > 0 ? (
        <div className="mb-3 grid gap-1.5">
          {comments.slice(-6).map((c: Comment) => (
            <div key={c.id} className="text-sm">
              <b className="text-ink">{c.authorName}</b> <span className="text-ink-soft">{c.text}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tu nombre" className="h-9 w-32 text-xs" />
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Escribe un comentario…"
          className="h-9 flex-1 text-xs"
        />
        <Button size="sm" variant="outline" className="h-9 border-brass/50 text-brass-dark" onClick={send} disabled={!text.trim()}>
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function ReviewForm({ barberId, onDone }: { barberId: string; onDone: () => void }) {
  const [name, setName] = useState("");
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [done, setDone] = useState(false);

  function send() {
    if (name.trim().length < 2) return;
    const { mutateDB } = require("@/lib/store") as typeof import("@/lib/store");
    mutateDB((d) => {
      d.comments.push({
        id: `cmt-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
        postId: null,
        barberId,
        authorName: name.trim().slice(0, 60),
        deviceId: deviceId(),
        rating,
        text: text.trim().slice(0, 600),
        createdAt: new Date().toISOString(),
      });
    });
    setDone(true);
    onDone();
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-good/40 bg-good/5 px-4 py-3 text-sm text-good">
        ¡Gracias por tu reseña! Ya es visible en el perfil.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-ink/10 bg-ivory p-4">
      <div className="text-sm font-semibold">Deja tu reseña</div>
      <div className="mt-3 grid gap-2 sm:grid-cols-[12rem_auto]">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tu nombre *" />
        <div className="flex items-center gap-1">
          {Array.from({ length: 5 }, (_, i) => (
            <button key={i} onClick={() => setRating(i + 1)} aria-label={`${i + 1} estrellas`}>
              <Star className={cn("h-6 w-6 transition", i < rating ? "fill-brass text-brass" : "text-ink/25 hover:text-brass")} />
            </button>
          ))}
        </div>
      </div>
      <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Cuéntanos cómo te fue (opcional)" className="mt-2" />
      <Button size="sm" className="mt-3 bg-ink text-ivory hover:bg-ink/80" onClick={send} disabled={name.trim().length < 2}>
        Publicar reseña
      </Button>
    </div>
  );
}

// ============================================================ RESEÑA DIRECTA (link/QR del barbero)
/** Pantalla pública de reseña rápida: llega por ?r=CODIGO (QR o link del
 * barbero). El cliente califica sin pasar por el wizard de reservas. */
function ReviewDirectView({ barber, onExit }: { barber: Barber; onExit: () => void }) {
  const [, force] = useState(0);
  const [name, setName] = useState("");
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [done, setDone] = useState(false);
  const db = getDB();
  const reviews = db.comments.filter((c) => c.barberId === barber.id && c.postId === null && !c.hidden && c.rating);
  const avg = reviews.length ? reviews.reduce((s, c) => s + (c.rating ?? 0), 0) / reviews.length : 0;

  function send() {
    if (name.trim().length < 2 || rating < 1) return;
    const { mutateDB } = require("@/lib/store") as typeof import("@/lib/store");
    mutateDB((d) => {
      d.comments.push({
        id: `cmt-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
        postId: null,
        barberId: barber.id,
        authorName: name.trim().slice(0, 60),
        deviceId: deviceId(),
        rating,
        text: text.trim().slice(0, 600),
        createdAt: new Date().toISOString(),
      });
    });
    setDone(true);
  }

  return (
    <div className="min-h-screen bg-cream px-4 py-8">
      <div className="mx-auto max-w-md">
        <div className="mb-4 text-center">
          <BrandLockup compact />
        </div>

        {done ? (
          <div className="rounded-3xl border border-good/40 bg-ivory p-8 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-good/15">
              <CheckCircle2 className="h-9 w-9 text-good" />
            </div>
            <h2 className="font-display text-2xl font-bold">¡Gracias por tu reseña!</h2>
            <p className="mt-2 text-sm text-ink-soft">Tu calificación de {barber.name} ya quedó registrada.</p>
            <Button className="mt-6 bg-ink text-ivory hover:bg-ink/80" onClick={onExit}>
              Volver a la barbería
            </Button>
          </div>
        ) : (
          <div className="rounded-3xl border border-ink/10 bg-ivory p-6 shadow-sm">
            <div className="flex flex-col items-center text-center">
              {barber.photo ? (
                <img src={barber.photo} alt={barber.name} className="h-20 w-20 rounded-2xl object-cover ring-4 ring-brass/30" />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-brass/15 font-display text-2xl font-bold text-brass-dark">
                  {barber.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                </div>
              )}
              <h2 className="mt-3 font-display text-xl font-bold">¿Cómo te fue con {barber.name}?</h2>
              <p className="mt-1 text-sm text-ink-soft">Tu reseña ayuda a otros clientes a elegirlo.</p>
              {reviews.length > 0 ? (
                <div className="mt-2 inline-flex items-center gap-1 text-sm text-ink-soft">
                  <Star className="h-4 w-4 fill-brass text-brass" /> {Math.round(avg * 10) / 10} / 5 · {reviews.length} reseña{reviews.length === 1 ? "" : "s"}
                </div>
              ) : null}
            </div>

            <div className="mt-6 flex justify-center gap-2" role="radiogroup" aria-label="Calificación">
              {Array.from({ length: 5 }, (_, i) => (
                <button
                  key={i}
                  onClick={() => setRating(i + 1)}
                  aria-label={`${i + 1} estrella${i === 0 ? "" : "s"}`}
                  className="transition hover:scale-110"
                >
                  <Star className={cn("h-10 w-10", i < rating ? "fill-brass text-brass" : "text-ink/20 hover:text-brass")} />
                </button>
              ))}
            </div>

            <div className="mt-5 space-y-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tu nombre *" />
              <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Cuéntale cómo te fue (opcional)" />
            </div>

            <Button
              className="mt-4 w-full bg-ink text-ivory hover:bg-ink/80"
              onClick={send}
              disabled={name.trim().length < 2 || rating < 1}
            >
              Enviar reseña
            </Button>
            <button onClick={onExit} className="mt-3 block w-full text-center text-xs text-ink-soft hover:text-ink hover:underline">
              Volver a la barbería
            </button>
            <div className="mt-2 text-center text-[10px] text-ink/35" onClick={() => force((n) => n + 1)}>
              {reviews.length} reseña{reviews.length === 1 ? "" : "s"} registrada{reviews.length === 1 ? "" : "s"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================ VISTA PÚBLICA
export function PublicView({ onLogin }: { onLogin: () => void }) {
  useMeloDB(); // el sitio público refleja en vivo los barberos/servicios que el dueño guarda
  const admin = getAdminData();
  const db = getDB();
  const site = admin.site;
  const [wizardOpen, setWizardOpen] = useState(false);
  const [profileFor, setProfileFor] = useState<Barber | null>(null);
  const [faqOpen, setFaqOpen] = useState<number | null>(0);
  const [socialOpen, setSocialOpen] = useState(false);
  // reseña directa por link/QR del barbero (?r=CODIGO) — se limpia la URL para
  // que al compartir la página no se reabra la reseña
  const [reviewFor, setReviewFor] = useState<Barber | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const r = params.get("r")?.trim().toUpperCase();
    if (r) {
      const b = getDB().barbers.find((x) => x.reviewCode?.toUpperCase() === r || x.code.toUpperCase() === r);
      if (b) setReviewFor(b);
      window.history.replaceState({}, "", window.location.pathname); // limpiar el link
    }
    if (params.get("reservar") === "1") {
      setWizardOpen(true);
      window.history.replaceState({}, "", window.location.pathname);
      setTimeout(() => document.getElementById("reservar")?.scrollIntoView({ behavior: "smooth" }), 150);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const services = db.services.filter((s) => s.active);
  const barbers = db.barbers.filter((b) => b.active);

  // pantalla de reseña directa: ocupa toda la vista (sin el sitio detrás)
  if (reviewFor) {
    return <ReviewDirectView barber={reviewFor} onExit={() => setReviewFor(null)} />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-cream text-ink">
      <header className="sticky top-0 z-30 border-b border-ink/10 bg-cream/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <BrandLockup />
          <div className="flex items-center gap-2">
            {site.showSocialHero ? (
              <Button variant="outline" className="border-brass text-brass-dark hover:bg-brass/10" onClick={() => setSocialOpen(!socialOpen)}>
                <Sparkles className="mr-2 h-4 w-4" /> {socialOpen ? "Ver reservas" : "Ver comunidad"}
              </Button>
            ) : null}
            <a href="#reservar" className="hidden sm:inline-flex">
              <Button variant="outline" className="border-brass text-brass-dark hover:bg-brass/10">Reservar cita</Button>
            </a>
          </div>
        </div>
        <PoleStripe className="rounded-none" />
      </header>

      <main className="flex-1">
        {/* HERO */}
        <section className="relative overflow-hidden border-b border-ink/10">
          {site.heroMediaMode === "VIDEO" && site.heroMedia[0]?.src ? (
            <video
              src={site.heroMedia[0].src}
              className="absolute inset-0 h-full w-full object-cover opacity-25"
              autoPlay muted loop playsInline preload="none" poster="/melo-logo.png"
              aria-hidden
            />
          ) : null}
          {(site.heroMediaMode === "IMAGE" || site.heroMediaMode === "CAROUSEL") && site.heroMedia[0]?.src ? (
            <img src={site.heroMedia[0].src} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover opacity-20" loading="eager" />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-r from-cream via-cream/85 to-cream/40" aria-hidden />
          <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 md:grid-cols-[1.2fr_0.8fr] md:py-20">
            <div>
              <Chip className="mb-4 border-brass/50 text-brass-dark">{site.heroBadge}</Chip>
              <h1 className="font-display text-4xl font-bold leading-tight md:text-6xl">
                {site.heroTitle}
                <br />
                <span className="text-melo">{site.heroTitleAccent}</span>
              </h1>
              <p className="mt-5 max-w-lg text-lg text-ink-soft">{site.heroSubtitle}</p>
              <div className="mt-7 flex flex-wrap gap-3">
                <a href="#reservar">
                  <Button size="lg" className="h-12 bg-melo px-7 text-base text-ivory hover:bg-melo-dark">
                    <Scissors className="mr-2 h-5 w-5" /> {site.heroPrimaryCta}
                  </Button>
                </a>
                {site.showServicesSection ? (
                  <a href="#servicios">
                    <Button size="lg" variant="outline" className="h-12 border-ink/25 px-7 text-base hover:bg-ivory">
                      {site.heroSecondaryCta}
                    </Button>
                  </a>
                ) : null}
              </div>
              <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-soft">
                {site.heroSchedule.map((line, i) => (
                  <span key={i} className="inline-flex items-center gap-2">
                    {i === 0 ? <Clock className="h-4 w-4 text-brass" /> : null} {line}
                  </span>
                ))}
                <span className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4 text-brass" /> Reserva confirmada por WhatsApp</span>
              </div>
            </div>
            <HeroMediaBlock />
          </div>
        </section>

        {/* MODO SOCIAL PÚBLICO (opcional) */}
        {site.showSocialHero && socialOpen ? (
          <section className="border-b border-ink/10 bg-ivory/50">
            <div className="mx-auto max-w-6xl px-4 py-12">
              <SectionTitle title="La comunidad MELO" sub="Conoce a los barberos, sus trabajos y sus reseñas reales." />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {barbers.map((b) => {
                  const reviews = db.comments.filter((c) => c.barberId === b.id && c.postId === null && !c.hidden && c.rating);
                  const avg = reviews.length ? reviews.reduce((s, c) => s + (c.rating ?? 0), 0) / reviews.length : 0;
                  return (
                    <button key={b.id} onClick={() => setProfileFor(b)} className="rounded-2xl border border-ink/10 bg-ivory p-5 text-left transition hover:-translate-y-0.5 hover:shadow-md">
                      <div className="flex items-center gap-4">
                        {b.photo ? (
                          <img src={b.photo} alt={b.name} className="h-16 w-16 rounded-full object-cover ring-2 ring-brass/40" />
                        ) : (
                          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brass/15 font-display text-xl font-bold text-brass-dark">
                            {b.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                          </span>
                        )}
                        <div>
                          <div className="font-semibold">{b.name}</div>
                          <div className="text-xs text-ink-soft">{b.specialty}</div>
                          <div className="mt-1 inline-flex items-center gap-1 text-sm">
                            <Star className="h-3.5 w-3.5 fill-brass text-brass" />
                            <b>{avg ? Math.round(avg * 10) / 10 : "—"}</b>
                            <span className="text-ink-soft">({reviews.length})</span>
                          </div>
                        </div>
                      </div>
                      {b.bio ? <p className="mt-3 line-clamp-2 text-sm text-ink-soft">{b.bio}</p> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        ) : null}

        {/* SERVICIOS */}
        {site.showServicesSection ? (
          <section id="servicios" className="border-b border-ink/10 bg-ivory/50">
            <div className="mx-auto max-w-6xl px-4 py-12">
              <div className="mb-6">
                <h2 className="font-display text-3xl font-bold">{site.servicesTitle}</h2>
                <p className="mt-1 text-ink-soft">{site.servicesSubtitle}</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {services.map((s) => (
                  <div key={s.id} className="rounded-2xl border border-ink/10 bg-ivory p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-display text-lg font-semibold">{s.name}</h3>
                      <span className="whitespace-nowrap font-display text-lg font-bold text-melo">{cop(s.price)}</span>
                    </div>
                    <p className="mt-2 min-h-10 text-sm text-ink-soft">{s.description}</p>
                    <div className="mt-3 flex items-center justify-between">
                      <Chip><Clock className="h-3.5 w-3.5" /> {s.durationMin} min</Chip>
                      <button
                        className="text-sm font-medium text-brass-dark underline-offset-2 hover:underline"
                        onClick={() => { setWizardOpen(true); window.scrollTo({ top: document.getElementById("reservar")?.offsetTop, behavior: "smooth" }); }}
                      >
                        Reservar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {/* EQUIPO (con perfiles visibles) */}
        {site.showTeamSection ? (
          <section className="border-b border-ink/10">
            <div className="mx-auto max-w-6xl px-4 py-12">
              <div className="mb-6">
                <h2 className="font-display text-3xl font-bold">{site.teamTitle}</h2>
                <p className="mt-1 text-ink-soft">{site.teamSubtitle}</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                {barbers.map((b) => {
                  const reviews = db.comments.filter((c) => c.barberId === b.id && c.postId === null && !c.hidden && c.rating);
                  const avg = reviews.length ? reviews.reduce((s, c) => s + (c.rating ?? 0), 0) / reviews.length : 0;
                  const postsCount = db.posts.filter((p) => p.barberId === b.id && !p.hidden).length;
                  return (
                    <button
                      key={b.id}
                      onClick={() => setProfileFor(b)}
                      className="group flex items-start gap-4 rounded-2xl border border-ink/10 bg-ivory p-5 text-left transition hover:-translate-y-0.5 hover:shadow-md"
                    >
                      {b.photo ? (
                        <img src={b.photo} alt={b.name} className="h-14 w-14 rounded-full object-cover ring-2 ring-brass/40" />
                      ) : (
                        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brass/15 font-display text-xl font-bold text-brass-dark">
                          {b.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                        </span>
                      )}
                      <div className="min-w-0">
                        <div className="font-semibold">{b.name}</div>
                        <div className="text-sm text-ink-soft">{b.specialty || "Barbero profesional"}</div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                          <span className="inline-flex items-center gap-1">
                            <Star className="h-3.5 w-3.5 fill-brass text-brass" />
                            <b>{avg ? Math.round(avg * 10) / 10 : "—"}</b>
                            <span className="text-ink-soft">({reviews.length})</span>
                          </span>
                          {postsCount > 0 ? <Chip className="text-[10px]">📸 {postsCount} trabajos</Chip> : null}
                        </div>
                      </div>
                      <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-ink/30 transition group-hover:text-brass" />
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        ) : null}

        {/* WIZARD */}
        {site.showBookingSection ? (
          <section id="reservar" className="border-b border-ink/10 bg-ivory/50">
            <div className="mx-auto max-w-3xl px-4 py-12">
              <div className="mb-6 text-center">
                <Chip className="mb-3 border-melo/40 text-melo-dark"><Sparkles className="h-3.5 w-3.5" /> 4 pasos</Chip>
                <h2 className="font-display text-3xl font-bold">{site.bookingTitle}</h2>
                <p className="mt-1 text-ink-soft">{site.bookingSubtitle}</p>
              </div>
              {services.length > 0 ? (
                <BookingWizard onHome={() => { setWizardOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
              ) : (
                <div className="rounded-2xl border border-dashed border-ink/15 px-6 py-10 text-center text-ink-soft">
                  El catálogo aún no tiene servicios activos.
                </div>
              )}
            </div>
          </section>
        ) : null}

        {/* FAQ */}
        {site.showFaqSection ? (
          <section className="border-b border-ink/10">
            <div className="mx-auto max-w-3xl px-4 py-12">
              <div className="mb-6 text-center">
                <h2 className="font-display text-3xl font-bold">{site.faqTitle}</h2>
                <p className="mt-1 text-ink-soft">{site.faqSubtitle}</p>
              </div>
              <div className="grid gap-2">
                {site.faq.map((item, i) => {
                  const open = faqOpen === i;
                  return (
                    <div key={i} className={cn("rounded-2xl border bg-ivory transition", open ? "border-brass/50 shadow-sm" : "border-ink/10")}>
                      <button
                        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left font-medium"
                        onClick={() => setFaqOpen(open ? null : i)}
                        aria-expanded={open}
                      >
                        {item.q}
                        <ChevronDown className={cn("h-4 w-4 shrink-0 text-ink-soft transition-transform", open && "rotate-180")} />
                      </button>
                      <div className={cn("grid transition-all duration-200", open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
                        <div className="overflow-hidden">
                          <p className="px-5 pb-4 text-sm leading-relaxed text-ink-soft">{item.a}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        ) : null}
      </main>

      {/* FOOTER / MEMBRETE */}
      <footer className="mt-auto bg-ink text-cream/90">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-3">
          <div>
            <div className="flex items-center gap-3">
              <Logo size={40} />
              <div className="leading-tight">
                <div className="font-display text-lg font-bold tracking-[0.18em] text-cream">MELO</div>
                <div className="text-[10px] uppercase tracking-[0.3em] text-cream/60">Barbershop</div>
              </div>
            </div>
            <p className="mt-3 max-w-xs text-sm text-cream/70">{site.footerTagline}</p>
            <div className="mt-3 flex gap-3 text-sm">
              {site.socialInstagram ? <a href={site.socialInstagram} target="_blank" rel="noopener noreferrer" className="text-cream/70 hover:text-cream" aria-label="Instagram">Instagram</a> : null}
              {site.socialFacebook ? <a href={site.socialFacebook} target="_blank" rel="noopener noreferrer" className="text-cream/70 hover:text-cream" aria-label="Facebook">Facebook</a> : null}
              {site.socialTiktok ? <a href={site.socialTiktok} target="_blank" rel="noopener noreferrer" className="text-cream/70 hover:text-cream" aria-label="TikTok">TikTok</a> : null}
            </div>
          </div>
          <div className="text-sm">
            <div className="mb-2 font-display text-base text-cream">Horario</div>
            {site.footerHours.map((h, i) => (
              <div key={i} className={i === site.footerHours.length - 1 ? "text-cream/50" : "text-cream/70"}>{h}</div>
            ))}
          </div>
          <div className="text-sm">
            <div className="mb-2 font-display text-base text-cream">Contacto</div>
            <div className="flex items-center gap-2 text-cream/70"><Phone className="h-4 w-4" /> {site.footerPhone}</div>
            {site.footerEmail ? <div className="mt-1 flex items-center gap-2 text-cream/70"><span className="break-all">{site.footerEmail}</span></div> : null}
            {site.footerAddress ? <div className="mt-1 flex items-center gap-2 text-cream/70"><MapPin className="h-4 w-4" /> {site.footerAddress}</div> : null}
          </div>
        </div>
        <div className="pole h-1.5" aria-hidden />
        <div className="flex items-center justify-center gap-4 py-3 text-xs text-cream/50">
          <span>© {new Date().getFullYear()} {site.businessName}</span>
          <button
            onClick={onLogin}
            aria-label="Configuración de la barbería"
            title="Configuración"
            className="rounded-full p-1.5 text-cream/35 transition hover:bg-cream/10 hover:text-cream/70"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </div>
      </footer>

      {profileFor ? <BarberPublicProfile barber={profileFor} onBack={() => setProfileFor(null)} /> : null}
    </div>
  );
}
