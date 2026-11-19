"use client";
// ============================================================ IA INTERNA (solo dueño)
// Chat flotante: el dueño pide cosas en español y la IA las ejecuta sobre la
// barbería (crear servicios/barberos, precios, horarios, intervalos). Cada
// cambio aplica en vivo en todo el sitio y queda en el historial de auditoría.
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { Sparkles, X, SendHorizonal, Bot, User } from "lucide-react";
import { runAssistantCommand } from "@/lib/engines/assistant";

type Msg = { role: "user" | "ai"; text: string; ok: boolean };

const EXAMPLES = [
  "Bloquea el 24 de noviembre que vamos a fumigar",
  "Cambia la frase del membrete a: Tu estilo, nuestra pasión",
  "El corte clásico ahora vale 40 mil",
  "Crea el barbero Luis",
  "Horario de Ronald: martes a sábado de 9 a 18",
  "¿Cuántas citas hay mañana?",
];

const WELCOME: Msg = {
  role: "ai",
  ok: true,
  text:
    "¡Hola! Soy tu IA interna de administración. Pídeme cambios como vengan a tu mente —entiendo aunque escribas rápido o con errores—:\n" +
    "bloquear días (fumigación, vacaciones), precios, horarios, servicios, el membrete y el WhatsApp, citas, gastos… " +
    "Todo se aplica en tiempo real y queda en el Historial. Escribe «ayuda» para ver ejemplos.",
};

export function AiAssistant() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [pulse, setPulse] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgs, open]);

  function send(text?: string) {
    const q = (text ?? input).trim();
    if (!q) return;
    setMsgs((m) => [...m, { role: "user", text: q, ok: true }]);
    setInput("");
    try {
      const res = runAssistantCommand(q);
      setMsgs((m) => [...m, { role: "ai", text: res.text, ok: res.ok }]);
      // toast solo cuando la IA aplicó un cambio real (viene con acciones)
      if (res.ok && res.actions && res.actions.length > 0) {
        toast({ title: "Cambio aplicado", description: "Ya visible en el sitio público y en todos los dispositivos." });
      }
    } catch (e) {
      setMsgs((m) => [...m, { role: "ai", text: "Ocurrió un error inesperado y no apliqué nada. Intenta de nuevo con otra redacción.", ok: false }]);
      console.error("[melo-ai]", e);
    }
    setPulse((n) => n + 1);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Abrir IA interna de administración"
        title="IA interna (solo dueño)"
        className={cn(
          "fixed bottom-5 right-5 z-50 flex h-14 items-center gap-2 rounded-full border border-ink/10 bg-ink px-5 text-sm font-semibold text-ivory shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl"
        )}
      >
        <Sparkles className="h-5 w-5 text-brass" /> IA interna
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex h-[min(560px,calc(100vh-2.5rem))] w-[min(400px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-ink/10 bg-ivory shadow-2xl">
      {/* cabecera */}
      <div className="flex items-center justify-between border-b border-ink/10 bg-ink px-4 py-3 text-ivory">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brass/20">
            <Bot className="h-4 w-4 text-brass" />
          </span>
          <div>
            <div className="text-sm font-bold leading-tight">IA interna</div>
            <div className="text-[10px] text-cream/60">Administración · solo el dueño</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setMsgs([WELCOME]); setInput(""); }}
            className="rounded-full px-2 py-1 text-[11px] text-cream/60 transition hover:bg-cream/10 hover:text-cream"
            title="Empezar de nuevo"
          >
            Reiniciar
          </button>
          <button onClick={() => setOpen(false)} aria-label="Cerrar" className="rounded-full p-1.5 text-cream/60 transition hover:bg-cream/10 hover:text-cream">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* mensajes */}
      <div ref={scrollRef} className="nice-scroll flex-1 space-y-3 overflow-y-auto bg-cream px-4 py-4">
        {msgs.map((m, i) => (
          <div key={i} className={cn("flex gap-2", m.role === "user" ? "justify-end" : "justify-start")}>
            {m.role === "ai" ? (
              <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-brass">
                <Bot className="h-3.5 w-3.5" />
              </span>
            ) : null}
            <div
              className={cn(
                "max-w-[85%] whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm",
                m.role === "user"
                  ? "rounded-br-sm bg-ink text-ivory"
                  : m.ok
                    ? "rounded-bl-sm border border-ink/10 bg-ivory text-ink"
                    : "rounded-bl-sm border border-melo/30 bg-melo/10 text-melo-dark"
              )}
            >
              {m.text}
            </div>
            {m.role === "user" ? (
              <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brass/25 text-brass-dark">
                <User className="h-3.5 w-3.5" />
              </span>
            ) : null}
          </div>
        ))}

        {/* ejemplos clicables mientras no hay preguntas */}
        {msgs.length <= 1 ? (
          <div className="space-y-1.5 pt-1">
            <div className="px-1 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">Prueba con:</div>
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => send(ex)}
                className="block w-full rounded-xl border border-ink/10 bg-ivory px-3 py-2 text-left text-xs text-ink-soft transition hover:border-brass/50 hover:bg-brass/10 hover:text-ink"
              >
                «{ex}»
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* entrada */}
      <div className="border-t border-ink/10 bg-ivory p-3">
        <div className="flex items-end gap-2">
          <Textarea
            key={pulse}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder="Pide cualquier cambio: «bloquea el 24 que fumigamos», «el fade vale 30 mil»…"
            className="max-h-28 min-h-10 flex-1 resize-none text-sm"
          />
          <Button size="icon" onClick={() => send()} disabled={!input.trim()} className="h-10 w-10 shrink-0 bg-melo hover:bg-melo-dark text-ivory" aria-label="Enviar">
            <SendHorizonal className="h-4 w-4" />
          </Button>
        </div>
        <p className="mt-1.5 text-[10px] text-ink-soft">Enter envía · Shift+Enter salta línea · todo queda en el Historial</p>
      </div>
    </div>
  );
}
