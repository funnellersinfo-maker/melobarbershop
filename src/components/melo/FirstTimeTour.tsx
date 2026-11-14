"use client";
// MELO BARBERSHOP — tour obligatorio de primera vez para el barbero.
// Burbujas con "Continuar" (única forma de avanzar) que van iluminando cada
// sección del panel como un mapa. Al terminar, el barbero queda libre.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { getOnboarding, setOnboarding, type SessionUser } from "@/lib/store";
import { Confetti } from "@/components/melo/Confetti";
import { Button } from "@/components/ui/button";
import { LockOpen, Map as MapIcon } from "lucide-react";
import type { ViewId } from "@/components/melo/AppShell";

type TourStep = {
  view?: ViewId; // a qué vista cambiar al entrar al paso
  target?: string; // selector del elemento a iluminar (data-tour-id / aria-label)
  icon: string;
  title: string;
  legend: string;
};

const STEPS: TourStep[] = [
  {
    view: "dashboard",
    icon: "👋",
    title: "¡Bienvenido a tu plataforma!",
    legend: "Este es tu espacio personal de MELO BARBERSHOP. Te vamos a mostrar el mapa en 7 paradas: en cada burbuja, tocá Continuar para desbloquear la siguiente.",
  },
  {
    view: "dashboard",
    target: '[data-tour-id="dashboard"]',
    icon: "⚡",
    title: "Mi día — tu cuartel general",
    legend: "Acá ves tu rango, tu barra de XP y cuántos servicios te faltan para el siguiente nivel. Volvé cada mañana para ver tu progreso.",
  },
  {
    view: "agenda",
    target: '[data-tour-id="agenda"]',
    icon: "📅",
    title: "Mi agenda",
    legend: "Tus citas del día, hora por hora. De acá pasás cada servicio de Reservada a Completada — y cada una completada te da XP.",
  },
  {
    view: "payments",
    target: '[data-tour-id="payments"]',
    icon: "💰",
    title: "Mis cobros",
    legend: "Registrás acá lo que te pagan en efectivo o transferencia. Todo queda a salvo para las liquidaciones.",
  },
  {
    view: "myCommissions",
    target: '[data-tour-id="myCommissions"]',
    icon: "percent",
    title: "Mis comisiones",
    legend: "Lo que vas ganando: lo pendiente de cobro y lo ya pagado. Tu plata, siempre clara.",
  },
  {
    view: "myProfile",
    target: '[data-tour-id="myProfile"]',
    icon: "📸",
    title: "Mi perfil",
    legend: "Tu foto, tu bio y tus mejores trabajos. Publicá seguido: los likes y las reseñas de los clientes construyen tu reputación.",
  },
  {
    view: "myAvailability",
    target: '[data-tour-id="myAvailability"]',
    icon: "🕐",
    title: "Mi disponibilidad",
    legend: "Definí tus horarios semanales. Con ellos la agenda sabe cuándo podés atender y se llena sola.",
  },
  {
    view: "notifications",
    target: '[aria-label="Notificaciones"]',
    icon: "🔔",
    title: "La campana",
    legend: "Te avisa cada cita nueva, pago o novedad. El puntito rojo significa que hay algo sin leer.",
  },
  {
    icon: "🏆",
    title: "¡Mapa completado!",
    legend: "Ya conocés tu plataforma entera. Sos libre: empezá por tu agenda de hoy y a sumar XP para subir de rango. ¡Nos vemos en la cima, futura Leyenda! 👑",
  },
];

export function FirstTimeTour({ user, setView, onFinish }: { user: SessionUser; setView: (v: ViewId) => void; onFinish: () => void }) {
  const initial = Math.min(Math.max(getOnboarding().tourStep, 0), STEPS.length - 1);
  const [idx, setIdx] = useState(initial);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const rafRef = useRef<number | null>(null);
  const step = STEPS[idx];
  const isLast = idx === STEPS.length - 1;

  // al entrar a cada paso: cambiar de vista y guardar progreso (retoma si cierra)
  useEffect(() => {
    setOnboarding({ tourStep: idx });
    if (step.view) setView(step.view);
  }, [idx, step.view, setView]);

  // localizar el elemento a iluminar (visible en este breakpoint)
  const locate = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      if (!step.target) {
        setRect(null);
        return;
      }
      const els = Array.from(document.querySelectorAll<HTMLElement>(step.target));
      const visible = els.find((el) => el.offsetParent !== null);
      setRect(visible ? visible.getBoundingClientRect() : null);
    });
  }, [step.target]);

  useLayoutEffect(() => {
    locate();
  }, [locate]);

  useEffect(() => {
    const evs: Array<[string, () => void]> = [
      ["resize", locate],
      ["scroll", locate, true] as unknown as [string, () => void],
    ];
    for (const [ev, fn] of evs) window.addEventListener(ev, fn, ev === "scroll" ? { capture: true, passive: true } : undefined);
    return () => {
      for (const [ev, fn] of evs) window.removeEventListener(ev, fn, ev === "scroll" ? { capture: true } : undefined);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [locate]);

  function next() {
    if (isLast) return;
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(35);
    setIdx((i) => i + 1);
  }

  function finish() {
    setOnboarding({ tourDone: true, tourStep: STEPS.length - 1 });
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate([50, 70, 50, 70, 150]);
    setCelebrate(true);
    setTimeout(() => onFinish(), 1800);
  }

  // spotlight: caja del objetivo + sombra gigante que oscurece el resto
  const spot = rect
    ? {
        left: Math.max(6, rect.left - 6),
        top: Math.max(6, rect.top - 6),
        width: Math.min(rect.width + 12, window.innerWidth - 12),
        height: rect.height + 12,
      }
    : null;

  return (
    <>
      {celebrate ? <Confetti /> : null}
      {/* capa que bloquea TODO hasta completar el tour (obligatorio) */}
      <div className="fixed inset-0 z-[110]" role="dialog" aria-modal="true" aria-label="Tour de bienvenida">
        {/* oscurecer todo */}
        <div className="absolute inset-0 bg-ink/60 backdrop-blur-[1px]" />

        {/* iluminar el objetivo */}
        {spot ? (
          <div
            className="animate-pop absolute rounded-xl ring-4 ring-brass"
            style={{
              left: spot.left,
              top: spot.top,
              width: spot.width,
              height: spot.height,
              boxShadow: "0 0 0 9999px rgba(28,25,23,0.6)",
            }}
          />
        ) : null}

        {/* burbuja del paso (estilo HUD de juego, abajo) */}
        <div
          className={cn(
            "absolute inset-x-3 bottom-3 z-10 mx-auto max-w-lg rounded-3xl border-2 border-brass/50 bg-ivory p-5 shadow-2xl sm:inset-x-6 sm:p-6",
            "animate-in fade-in slide-in-from-bottom-4 duration-300"
          )}
        >
          <div className="flex items-start gap-3">
            <span className="text-3xl leading-none">{step.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <MapIcon className="h-3.5 w-3.5 text-brass-dark" />
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-brass-dark">
                  Mapa · parada {idx + 1} de {STEPS.length}
                </span>
              </div>
              <h3 className="mt-0.5 font-display text-xl font-bold leading-tight">{step.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{step.legend}</p>
            </div>
          </div>

          {/* progreso como camino con estaciones */}
          <div className="mt-4 flex items-center gap-1.5">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={cn(
                  "h-2 flex-1 rounded-full transition-all",
                  i < idx ? "bg-brass" : i === idx ? "bg-melo" : "bg-ink/15"
                )}
              />
            ))}
          </div>

          <Button
            onClick={isLast ? finish : next}
            className="mt-4 h-12 w-full bg-gradient-to-r from-brass to-melo text-base font-bold text-ivory hover:opacity-90"
          >
            <LockOpen className="mr-2 h-5 w-5" />
            {isLast ? "¡Desbloquear y ser libre!" : "Continuar"}
          </Button>
          <p className="mt-1.5 text-center text-[10px] text-ink-soft">
            {isLast
              ? "Última parada del mapa"
              : "Obligatorio: continuá para desbloquear la siguiente parada"}
          </p>
        </div>
      </div>
    </>
  );
}
