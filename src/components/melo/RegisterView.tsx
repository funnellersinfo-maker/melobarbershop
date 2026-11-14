"use client";
// MELO BARBERSHOP — registro gamificado del barbero (con invitación).
// Educa al prospecto sobre XP, rangos y el mapa de la plataforma, paso a paso,
// con desbloqueo dopaminérgico al final. Al terminar arranca el tour de primera vez.
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { registerBarber, setOnboarding, setSession, type SessionUser } from "@/lib/store";
import { isValidEmail, validateInvitation } from "@/lib/invite";
import { LEVELS } from "@/components/melo/Dashboards";
import { Confetti } from "@/components/melo/Confetti";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo, PoleStripe } from "@/components/melo/ui";
import {
  ArrowLeft, ArrowRight, KeyRound, Lock, LockOpen, Zap, CalendarDays, Wallet, Percent,
  User, Star, Heart, Scissors, Sparkles, PartyPopper, Mail, ShieldCheck,
} from "lucide-react";

const TOTAL_STEPS = 6; // 0..5

export function RegisterView({ onBack, onRegistered }: { onBack: () => void; onRegistered: (u: SessionUser) => void }) {
  const [step, setStep] = useState(0);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [inviteErr, setInviteErr] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [name, setName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [pass1, setPass1] = useState("");
  const [pass2, setPass2] = useState("");
  const [accountErr, setAccountErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [celebrating, setCelebrating] = useState(false);

  const progress = useMemo(() => Math.round(((step + 1) / TOTAL_STEPS) * 100), [step]);

  function tryUnlock(e: React.FormEvent) {
    e.preventDefault();
    setInviteErr(null);
    if (!isValidEmail(email)) {
      setInviteErr("Escribe el correo con el que te invitaron (ej: tucorreo@gmail.com).");
      return;
    }
    if (!validateInvitation(email, code)) {
      setInviteErr("El correo y el código no coinciden. Pídele al dueño que verifique tu invitación.");
      return;
    }
    setUnlocked(true);
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate([40, 60, 40]);
    setTimeout(() => setStep(1), 650);
  }

  function createAccount() {
    setAccountErr(null);
    if (pass1 !== pass2) {
      setAccountErr("Las dos claves no coinciden. Revísalas.");
      return;
    }
    setBusy(true);
    const res = registerBarber({ name, email, accessCode: pass1, specialty });
    if (!res.ok) {
      setAccountErr(res.error);
      setBusy(false);
      return;
    }
    // desbloqueo dopaminérgico
    setCelebrating(true);
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate([60, 80, 60, 80, 120]);
    setOnboarding({ tourDone: false, tourStep: 0 }); // el tour arranca al entrar
    setTimeout(() => {
      const user: SessionUser = { role: "BARBER", id: res.barberId, name: name.trim() };
      setSession(user);
      onRegistered(user);
    }, 2400);
  }

  return (
    <div className="flex min-h-screen flex-col bg-cream text-ink">
      {celebrating ? <Confetti /> : null}
      <header className="border-b border-ink/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
            <ArrowLeft className="h-4 w-4" /> Volver
          </button>
          <div className="flex items-center gap-2">
            <Logo size={30} />
            <span className="font-display text-lg font-bold tracking-widest">MELO</span>
          </div>
        </div>
        <PoleStripe className="rounded-none" />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">
          {/* barra de progreso gamificada */}
          <div className="mb-4">
            <div className="mb-1 flex items-center justify-between text-xs font-semibold text-ink-soft">
              <span className="inline-flex items-center gap-1">
                {unlocked ? <LockOpen className="h-3.5 w-3.5 text-good" /> : <Lock className="h-3.5 w-3.5" />}
                {unlocked ? "Invitación verificada" : "Registro del barbero"}
              </span>
              <span>Paso {step + 1} de {TOTAL_STEPS}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-ink/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brass to-melo transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <div className="rounded-3xl border border-ink/10 bg-ivory p-6 shadow-md sm:p-8" key={step}>
            {/* ============ PASO 0: invitación ============ */}
            {step === 0 ? (
              <div className="animate-in fade-in slide-in-from-bottom-2">
                <div className="mb-3 flex items-center gap-2 text-brass-dark">
                  <KeyRound className="h-4 w-4" />
                  <span className="text-xs font-semibold uppercase tracking-[0.2em]">Acceso con invitación</span>
                </div>
                <h1 className="font-display text-3xl font-bold">¡Te esperábamos! ✂️</h1>
                <p className="mt-2 text-sm text-ink-soft">
                  El dueño ya guardó tu lugar en MELO BARBERSHOP. Ingresa el <b>correo</b> con el que te invitaron y tu{" "}
                  <b>código único</b> para desbloquear tu registro.
                </p>
                <form onSubmit={tryUnlock} className="mt-5 grid gap-3">
                  <div className="grid gap-1">
                    <label htmlFor="reg-email" className="text-xs font-semibold">Tu correo (el de la invitación)</label>
                    <Input id="reg-email" type="email" inputMode="email" autoComplete="email" value={email}
                      onChange={(e) => setEmail(e.target.value)} placeholder="tucorreo@gmail.com" required />
                  </div>
                  <div className="grid gap-1">
                    <label htmlFor="reg-code" className="text-xs font-semibold">Código de invitación</label>
                    <Input id="reg-code" value={code} onChange={(e) => setCode(e.target.value)}
                      placeholder="XXXX-XXXX" className="text-center tracking-[0.25em] uppercase" required />
                  </div>
                  {inviteErr ? (
                    <div className="rounded-lg border border-melo/40 bg-melo/10 px-3 py-2 text-sm text-melo-dark">{inviteErr}</div>
                  ) : null}
                  <Button type="submit" disabled={!email.trim() || !code.trim()}
                    className="mt-1 bg-ink text-ivory hover:bg-ink/80">
                    <LockOpen className="mr-2 h-4 w-4" /> Desbloquear mi acceso
                  </Button>
                  <p className="text-center text-[11px] text-ink-soft">
                    ¿No tienes código? Pídeselo al dueño de la barbería.
                  </p>
                </form>
                {unlocked ? (
                  <div className="animate-pop mt-4 rounded-xl border border-good/50 bg-good/10 px-4 py-3 text-center text-sm font-semibold text-good">
                    🔓 ¡Invitación válida! Preparando tu aventura…
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* ============ PASO 1: qué es el XP ============ */}
            {step === 1 ? (
              <div className="animate-in fade-in slide-in-from-bottom-2">
                <StepBadge n={1} icon={<Zap className="h-4 w-4" />} label="Lo primero" />
                <h2 className="font-display text-2xl font-bold">¿Qué es el XP? ⚡</h2>
                <p className="mt-2 text-sm text-ink-soft">
                  El <b>XP es tu experiencia de barbero</b> dentro de MELO. Cada servicio que completás te da{" "}
                  <b>1 XP</b> — es tu llave para subir de rango.
                </p>
                <div className="mt-5 grid gap-3">
                  <div className="flex items-center gap-3 rounded-2xl border border-brass/40 bg-brass/5 p-4">
                    <span className="text-3xl">✂️</span>
                    <div className="text-sm">
                      <b>Terminás un corte</b>
                      <div className="text-ink-soft">+1 XP automáticamente</div>
                    </div>
                    <span className="ml-auto rounded-full bg-brass/20 px-2 py-1 text-xs font-bold text-brass-dark">+1 XP</span>
                  </div>
                  <div className="flex items-center gap-3 rounded-2xl border border-ink/10 bg-cream p-4">
                    <span className="text-3xl">📈</span>
                    <div className="text-sm">
                      <b>Tu barra se llena</b>
                      <div className="text-ink-soft">La ves crecer en tu panel cada día</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 rounded-2xl border border-ink/10 bg-cream p-4">
                    <span className="text-3xl">🔓</span>
                    <div className="text-sm">
                      <b>Llegás al siguiente rango</b>
                      <div className="text-ink-soft">Más reconocimiento en la barbería</div>
                    </div>
                  </div>
                </div>
                <ContinueBtn onClick={() => setStep(2)} />
              </div>
            ) : null}

            {/* ============ PASO 2: los rangos ============ */}
            {step === 2 ? (
              <div className="animate-in fade-in slide-in-from-bottom-2">
                <StepBadge n={2} icon={<Sparkles className="h-4 w-4" />} label="Tu escalera" />
                <h2 className="font-display text-2xl font-bold">Los 5 rangos 🪜</h2>
                <p className="mt-2 text-sm text-ink-soft">Todos arrancan como <b>Aprendiz</b>. Cada rango se desbloquea con XP:</p>
                <div className="mt-5 grid gap-2">
                  {LEVELS.map((lv, i) => (
                    <div key={lv.name} className={cn(
                      "flex items-center gap-3 rounded-xl border p-3",
                      i === 0 ? "border-brass/60 bg-brass/10" : "border-ink/10 bg-cream"
                    )}>
                      <span className="text-2xl">{lv.icon}</span>
                      <div className="text-sm font-semibold">{lv.name}</div>
                      <span className="ml-auto text-xs font-bold tabular-nums text-ink-soft">{lv.min} XP</span>
                      {i === 0 ? <span className="rounded-full bg-brass/20 px-2 py-0.5 text-[10px] font-bold text-brass-dark">EMPIEZAS AQUÍ</span> : null}
                    </div>
                  ))}
                </div>
                <ContinueBtn onClick={() => setStep(3)} />
              </div>
            ) : null}

            {/* ============ PASO 3: cómo ganar XP y reputación ============ */}
            {step === 3 ? (
              <div className="animate-in fade-in slide-in-from-bottom-2">
                <StepBadge n={3} icon={<Scissors className="h-4 w-4" />} label="Tu misión" />
                <h2 className="font-display text-2xl font-bold">Cómo crecer 🚀</h2>
                <p className="mt-2 text-sm text-ink-soft">Tu progreso tiene dos frentes: el <b>XP</b> (rangos) y tu <b>reputación</b> (fama).</p>
                <div className="mt-5 grid gap-3">
                  <MissionCard icon={<CalendarDays className="h-5 w-5" />} title="Atiende tus citas" sub="Cada servicio completado en tu agenda te da XP." chip="+ XP" />
                  <MissionCard icon={<Star className="h-5 w-5" />} title="Encanta a tus clientes" sub="Las reseñas de 5 estrellas construyen tu reputación." chip="⭐ Reputación" />
                  <MissionCard icon={<Heart className="h-5 w-5" />} title="Publica tus trabajos" sub="Sube fotos de tus cortes y junta me gusta en tu perfil." chip="❤️ Reputación" />
                </div>
                <ContinueBtn onClick={() => setStep(4)} />
              </div>
            ) : null}

            {/* ============ PASO 4: el mapa ============ */}
            {step === 4 ? (
              <div className="animate-in fade-in slide-in-from-bottom-2">
                <StepBadge n={4} icon={<PartyPopper className="h-4 w-4" />} label="Tu mapa" />
                <h2 className="font-display text-2xl font-bold">Tu mapa del tesoro 🗺️</h2>
                <p className="mt-2 text-sm text-ink-soft">
                  Al entrar vas a encontrar estas salas. Te las mostraremos una por una en un <b>tour al final del registro</b>:
                </p>
                <div className="mt-5 grid grid-cols-2 gap-2 text-sm">
                  <MapCard icon={<User className="h-5 w-5" />} title="Mi día" sub="Tu nivel, XP y barra de progreso" />
                  <MapCard icon={<CalendarDays className="h-5 w-5" />} title="Mi agenda" sub="Tus citas del día, hora por hora" />
                  <MapCard icon={<Wallet className="h-5 w-5" />} title="Mis cobros" sub="Registrás lo que te pagan" />
                  <MapCard icon={<Percent className="h-5 w-5" />} title="Mis comisiones" sub="Lo que vas ganando" />
                  <MapCard icon={<User className="h-5 w-5" />} title="Mi perfil" sub="Foto, bio y tus trabajos" />
                  <MapCard icon={<Zap className="h-5 w-5" />} title="Notificaciones" sub="La campana te avisa todo" />
                </div>
                <ContinueBtn onClick={() => setStep(5)} />
              </div>
            ) : null}

            {/* ============ PASO 5: crear cuenta ============ */}
            {step === 5 ? (
              <div className="animate-in fade-in slide-in-from-bottom-2">
                <StepBadge n={5} icon={<ShieldCheck className="h-4 w-4" />} label="Último paso" />
                <h2 className="font-display text-2xl font-bold">Creá tu cuenta 🎉</h2>
                <p className="mt-2 text-sm text-ink-soft">Elegí tu nombre y la <b>clave con la que vas a entrar</b> de ahora en adelante.</p>
                <div className="mt-5 grid gap-3">
                  <div className="grid gap-1">
                    <label htmlFor="reg-name" className="text-xs font-semibold">Tu nombre</label>
                    <Input id="reg-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Juan Pérez" required />
                  </div>
                  <div className="grid gap-1">
                    <label htmlFor="reg-spec" className="text-xs font-semibold">Especialidad (opcional)</label>
                    <Input id="reg-spec" value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="Ej: Fades y diseño" />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-1">
                      <label htmlFor="reg-pass1" className="text-xs font-semibold">Tu clave de acceso</label>
                      <Input id="reg-pass1" type="password" value={pass1} onChange={(e) => setPass1(e.target.value)} placeholder="Mínimo 4 caracteres" required />
                    </div>
                    <div className="grid gap-1">
                      <label htmlFor="reg-pass2" className="text-xs font-semibold">Repetí la clave</label>
                      <Input id="reg-pass2" type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} placeholder="Otra vez" required />
                    </div>
                  </div>
                  {accountErr ? (
                    <div className="rounded-lg border border-melo/40 bg-melo/10 px-3 py-2 text-sm text-melo-dark">{accountErr}</div>
                  ) : null}
                  <Button
                    disabled={busy || name.trim().length < 3 || pass1.length < 4 || !pass2}
                    onClick={createAccount}
                    className="mt-1 bg-gradient-to-r from-brass to-melo text-ivory hover:opacity-90"
                  >
                    <LockOpen className="mr-2 h-4 w-4" /> ¡Desbloquear mi plataforma!
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          {/* pasos educativos: no se puede saltar, solo Continuar */}
          {step >= 1 && step <= 4 ? (
            <div className="mt-3 flex items-center justify-center gap-1.5">
              {Array.from({ length: TOTAL_STEPS }, (_, i) => (
                <span key={i} className={cn("h-2 rounded-full transition-all", i === step ? "w-6 bg-melo" : i < step ? "w-2 bg-brass" : "w-2 bg-ink/15")} />
              ))}
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}

function StepBadge({ n, icon, label }: { n: number; icon: React.ReactNode; label: string }) {
  return (
    <div className="mb-3 flex items-center gap-2 text-brass-dark">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brass/15 text-[11px] font-bold">{n}</span>
      <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.2em]">{icon} {label}</span>
    </div>
  );
}

function ContinueBtn({ onClick }: { onClick: () => void }) {
  return (
    <Button onClick={onClick} className="mt-5 w-full bg-ink text-ivory hover:bg-ink/80">
      Continuar <ArrowRight className="ml-2 h-4 w-4" />
    </Button>
  );
}

function MissionCard({ icon, title, sub, chip }: { icon: React.ReactNode; title: string; sub: string; chip: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-ink/10 bg-cream p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brass/15 text-brass-dark">{icon}</span>
      <div className="min-w-0 text-sm">
        <b>{title}</b>
        <div className="text-ink-soft">{sub}</div>
      </div>
      <span className="ml-auto shrink-0 rounded-full bg-brass/15 px-2 py-1 text-[10px] font-bold text-brass-dark">{chip}</span>
    </div>
  );
}

function MapCard({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-ink/10 bg-cream p-3">
      <div className="flex items-center gap-2 text-brass-dark">{icon} <b className="text-ink">{title}</b></div>
      <div className="mt-1 text-xs text-ink-soft">{sub}</div>
    </div>
  );
}
