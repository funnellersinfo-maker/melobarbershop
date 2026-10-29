"use client";
// Página pública de MELO BARBERSHOP: catálogo, equipo y wizard de reserva (requisito F).
import { useEffect, useMemo, useState } from "react";
import { api, useData } from "@/lib/api";
import { cop } from "@/lib/money";
import { DIAS_CORTOS, MESES_CORTOS, dateKeyInBogota, partsInBogota, pad2, addDaysKey, DIAS } from "@/lib/time";
import { BrandLockup, PoleStripe, Chip, LoadingBlock, ErrorBlock, STATUS_META } from "@/components/melo/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Scissors, CalendarDays, Clock, CheckCircle2, ChevronLeft, ChevronRight, Sparkles, Phone, MapPin, Users } from "lucide-react";

type PublicCatalog = {
  services: Array<{ id: string; name: string; description: string | null; price: number; durationMin: number }>;
  barbers: Array<{ id: string; name: string }>;
};
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

export function PublicView({ onLogin }: { onLogin: () => void }) {
  const { data, error, loading } = useData<PublicCatalog>("/api/public/catalog");
  const [wizardOpen, setWizardOpen] = useState(false);
  const catalog = data ?? { services: [], barbers: [] };

  return (
    <div className="min-h-screen flex flex-col bg-cream text-ink">
      <header className="sticky top-0 z-30 border-b border-ink/10 bg-cream/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <BrandLockup />
          <div className="flex items-center gap-2">
            <a href="#reservar" className="hidden sm:inline-flex">
              <Button variant="outline" className="border-brass text-brass-dark hover:bg-brass/10">Reservar cita</Button>
            </a>
            <Button onClick={onLogin} className="bg-ink text-ivory hover:bg-ink/80">
              <Users className="mr-2 h-4 w-4" /> Ingresar
            </Button>
          </div>
        </div>
        <PoleStripe className="rounded-none" />
      </header>

      <main className="flex-1">
        {/* HERO */}
        <section className="relative overflow-hidden border-b border-ink/10">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 md:grid-cols-[1.2fr_0.8fr] md:py-20">
            <div>
              <Chip className="mb-4 border-brass/50 text-brass-dark">Estética y barbería clásica</Chip>
              <h1 className="font-display text-4xl font-bold leading-tight md:text-6xl">
                Más que un corte,
                <br />
                <span className="text-melo">una experiencia…</span>
              </h1>
              <p className="mt-5 max-w-lg text-lg text-ink-soft">
                Reserva en línea con el barbero de tu preferencia. Sin filas, sin llamadas: elige el servicio, la hora y nosotros nos encargamos del resto.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <a href="#reservar">
                  <Button size="lg" className="h-12 bg-melo px-7 text-base text-ivory hover:bg-melo-dark">
                    <Scissors className="mr-2 h-5 w-5" /> Reservar ahora
                  </Button>
                </a>
                <a href="#servicios">
                  <Button size="lg" variant="outline" className="h-12 border-ink/25 px-7 text-base hover:bg-ivory">
                    Ver servicios y precios
                  </Button>
                </a>
              </div>
              <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-soft">
                <span className="inline-flex items-center gap-2"><Clock className="h-4 w-4 text-brass" /> Mar–Sáb · 10:00–13:00 y 14:00–19:00</span>
                <span className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4 text-brass" /> Confirmación por WhatsApp</span>
              </div>
            </div>
            <div className="relative mx-auto hidden md:block">
                <img
                src="/melo-logo.png"
                alt="MELO BARBERSHOP"
                className="mx-auto h-64 w-64 rounded-3xl border-8 border-ivory object-cover shadow-xl"
              />
              <div className="pole absolute -right-2 top-8 h-56 w-5 rounded-full shadow-md" aria-hidden />
            </div>
          </div>
        </section>

        {/* SERVICIOS */}
        <section id="servicios" className="border-b border-ink/10 bg-ivory/50">
          <div className="mx-auto max-w-6xl px-4 py-12">
            <div className="mb-6">
              <h2 className="font-display text-3xl font-bold">Servicios</h2>
              <p className="mt-1 text-ink-soft">Precios de demostración editables por el propietario desde el panel.</p>
            </div>
            {loading ? <LoadingBlock /> : error ? <ErrorBlock message={error} /> : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {catalog.services.map((s) => (
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
            )}
          </div>
        </section>

        {/* EQUIPO */}
        <section className="border-b border-ink/10">
          <div className="mx-auto max-w-6xl px-4 py-12">
            <div className="mb-6">
              <h2 className="font-display text-3xl font-bold">Nuestro equipo</h2>
              <p className="mt-1 text-ink-soft">Elige con quién quieres tu experiencia. O deja que el sistema asigne el barbero disponible.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {catalog.barbers.map((b) => (
                <div key={b.id} className="flex items-center gap-4 rounded-2xl border border-ink/10 bg-ivory p-5">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brass/15 font-display text-xl font-bold text-brass-dark">
                    {b.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                  </div>
                  <div>
                    <div className="font-semibold">{b.name}</div>
                    <div className="text-sm text-ink-soft">Barbero profesional</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* WIZARD */}
        <section id="reservar" className="border-b border-ink/10 bg-ivory/50">
          <div className="mx-auto max-w-3xl px-4 py-12">
            <div className="mb-6 text-center">
              <Chip className="mb-3 border-melo/40 text-melo-dark"><Sparkles className="h-3.5 w-3.5" /> 4 pasos</Chip>
              <h2 className="font-display text-3xl font-bold">Reserva tu cita</h2>
              <p className="mt-1 text-ink-soft">Recibirás un código de cita y confirmación por WhatsApp cuando esté configurado.</p>
            </div>
            {catalog.services.length > 0 ? (
              <BookingWizard catalog={catalog} openSignal={wizardOpen} />
            ) : (
              <LoadingBlock label="Cargando catálogo…" />
            )}
          </div>
        </section>
      </main>

      <footer className="mt-auto bg-ink text-cream/90">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-3">
          <div>
            <BrandLockup compact />
            <p className="mt-3 max-w-xs text-sm text-cream/70">Más que un corte, una experiencia. Barbería clásica con estándar moderno.</p>
          </div>
          <div className="text-sm">
            <div className="mb-2 font-display text-base text-cream">Horario</div>
            <div className="text-cream/70">Martes a sábado</div>
            <div className="text-cream/70">10:00–13:00 · 14:00–19:00</div>
            <div className="mt-1 text-cream/50">Domingo y lunes: cerrado</div>
          </div>
          <div className="text-sm">
            <div className="mb-2 font-display text-base text-cream">Contacto</div>
            <div className="flex items-center gap-2 text-cream/70"><Phone className="h-4 w-4" /> +57 300 123 4567</div>
            <div className="mt-1 flex items-center gap-2 text-cream/70"><MapPin className="h-4 w-4" /> Calle de la Barbería, Bogotá</div>
          </div>
        </div>
        <div className="pole h-1.5" aria-hidden />
        <div className="py-3 text-center text-xs text-cream/50">© {new Date().getFullYear()} MELO BARBERSHOP</div>
      </footer>
    </div>
  );
}

function BookingWizard({ catalog, openSignal }: { catalog: PublicCatalog; openSignal: boolean }) {
  const [step, setStep] = useState(1);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [barberChoice, setBarberChoice] = useState<string>("ANY");
  const [date, setDate] = useState<string>(dateKeyInBogota(new Date()));
  const [time, setTime] = useState<string | null>(null);
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [result, setResult] = useState<{ code: string; barber: string; service: string; price: number; date: string; time: string } | null>(null);

  const days = useMemo(() => nextDays(21), []);
  const service = catalog.services.find((s) => s.id === serviceId) ?? null;

  const slotsQ = useData<{ slots: Slot[] }>(
    serviceId && date ? `/api/public/slots?serviceId=${serviceId}&date=${date}&barberId=${barberChoice}` : null,
    [serviceId, date, barberChoice]
  );

  useEffect(() => {
    if (openSignal) setStep(1);
  }, [openSignal]);

  async function confirm() {
    if (!serviceId || !time) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await api<{ appointment: { code: string; barber: string; service: string; price: number; date: string; time: string } }>(
        "/api/public/book",
        {
          method: "POST",
          body: JSON.stringify({
            serviceId,
            date,
            time,
            barberId: barberChoice,
            clientName: clientName.trim(),
            clientPhone: clientPhone.trim() || null,
            clientEmail: clientEmail.trim() || null,
          }),
        }
      );
      setResult(res.appointment);
      setStep(5);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "No se pudo reservar");
      if (err instanceof Error && err.message.includes("cruza")) slotsQ.reload();
    } finally {
      setSending(false);
    }
  }

  function reset() {
    setStep(1); setServiceId(null); setBarberChoice("ANY"); setTime(null);
    setClientName(""); setClientPhone(""); setClientEmail(""); setResult(null); setSendError(null);
  }

  const stepTitles = ["Servicio", "Barbero", "Fecha y hora", "Tus datos", "Listo"];

  return (
    <div className="rounded-3xl border border-ink/10 bg-ivory p-6 shadow-sm md:p-8">
      {/* stepper */}
      <ol className="mb-6 flex items-center gap-2 text-xs">
        {stepTitles.map((t, i) => {
          const n = i + 1;
          const active = step === n;
          const done = step > n || (step === 5 && n === 5);
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
          {catalog.services.map((s) => (
            <button
              key={s.id}
              onClick={() => { setServiceId(s.id); setStep(2); }}
              className={cn(
                "rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md",
                serviceId === s.id ? "border-melo bg-melo/5" : "border-ink/15 bg-ivory"
              )}
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
              <div className="mt-1 text-sm text-ink-soft">Asignamos el primer barbero disponible (reparto equilibrado).</div>
            </button>
            {catalog.barbers.map((b) => (
              <button
                key={b.id}
                onClick={() => { setBarberChoice(b.id); setStep(3); }}
                className="flex items-center gap-3 rounded-2xl border border-ink/15 bg-ivory p-4 text-left hover:shadow-md"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brass/15 font-display font-bold text-brass-dark">
                  {b.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                </span>
                <span>
                  <span className="block font-semibold">{b.name}</span>
                  <span className="text-sm text-ink-soft">Barbero profesional</span>
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
            <div className="flex gap-1">
              <button className="rounded-lg border border-ink/15 px-2 py-1 text-sm" onClick={() => setDate((d) => addDaysKey(d, -1) >= dateKeyInBogota(new Date()) ? addDaysKey(d, -1) : d)} aria-label="Día anterior">
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>
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
          {slotsQ.loading ? <LoadingBlock label="Buscando horarios…" /> : null}
          {slotsQ.error ? <ErrorBlock message={slotsQ.error} onRetry={slotsQ.reload} /> : null}
          {slotsQ.data && slotsQ.data.slots.length === 0 ? (
            <div className="rounded-xl border border-dashed border-ink/20 bg-cream px-4 py-8 text-center text-ink-soft">
              No hay horarios disponibles para este día con esta selección.
              Prueba otro día u otro barbero.
            </div>
          ) : null}
          {slotsQ.data && slotsQ.data.slots.length > 0 ? (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {slotsQ.data.slots.map((s) => (
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
          ) : null}
          <StepBack onClick={() => setStep(2)} />
        </div>
      ) : null}

      {step === 4 && service && time ? (
        <div className="mx-auto max-w-md">
          <div className="mb-4 rounded-xl bg-cream p-4 text-sm">
            <div className="font-semibold">{service.name} · {cop(service.price)}</div>
            <div className="mt-1 text-ink-soft">
              {barberChoice === "ANY" ? "Cualquier barbero disponible" : catalog.barbers.find((b) => b.id === barberChoice)?.name} ·{" "}
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
              <Input id="r-phone" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} placeholder="+57 300 000 0000" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="r-email">Correo (opcional)</Label>
              <Input id="r-email" type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="tu@correo.com" />
            </div>
          </div>
          {sendError ? <div className="mt-4 rounded-lg border border-melo/40 bg-melo/10 px-4 py-3 text-sm text-melo-dark">{sendError}</div> : null}
          <div className="mt-6 flex items-center justify-between">
            <StepBack onClick={() => setStep(3)} bare />
            <Button disabled={sending || clientName.trim().length < 2} onClick={confirm} className="bg-melo px-8 text-ivory hover:bg-melo-dark">
              {sending ? "Reservando…" : "Confirmar reserva"}
            </Button>
          </div>
        </div>
      ) : null}

      {step === 5 && result ? (
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-good/15">
            <CheckCircle2 className="h-9 w-9 text-good" />
          </div>
          <h3 className="font-display text-2xl font-bold">¡Tu cita quedó reservada!</h3>
          <p className="mt-1 text-ink-soft">Te esperamos puntual. Si no puedes asistir, avísanos para liberar el cupo.</p>
          <div className="mx-auto mt-6 max-w-md rounded-2xl border border-brass/40 bg-cream p-5 text-left">
            <div className="flex items-center justify-between">
              <span className="text-sm text-ink-soft">Código de cita</span>
              <span className="font-display text-2xl font-bold tracking-widest text-melo">{result.code}</span>
            </div>
            <div className="mt-3 space-y-1 text-sm">
              <div>Servicio: <b>{result.service}</b></div>
              <div>Barbero: <b>{result.barber}</b></div>
              <div>Valor: <b>{cop(result.price)}</b></div>
              <div>Fecha: <b>{result.date} · {result.time}</b></div>
              <div className="text-ink-soft">Estado: {STATUS_META.RESERVED.label}</div>
            </div>
          </div>
          {clientPhone ? (
            <p className="mt-4 text-sm text-ink-soft">
              Enviaremos la confirmación y un recordatorio por WhatsApp{` `}
              <span className="text-brass-dark">(si la integración está configurada)</span>.
            </p>
          ) : null}
          <Button variant="outline" className="mt-6 border-ink/25" onClick={reset}>Reservar otra cita</Button>
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
