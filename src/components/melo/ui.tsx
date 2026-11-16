"use client";
// Piezas visuales compartidas del sistema MELO.
import { useEffect, useState } from "react";
import { cop } from "@/lib/money";
import { cn } from "@/lib/utils";

export function Logo({ size = 44 }: { size?: number }) {
  return (
    <img
      src="/melo-logo.png"
      alt="Logo MELO BARBERSHOP: chihuahua entre postes de barbero"
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className="rounded-full object-cover ring-2 ring-brass/60 bg-cream"
    />
  );
}

export function BrandLockup({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <Logo size={compact ? 36 : 46} />
      <div className="leading-tight">
        <div className={cn("font-display font-bold tracking-[0.18em] text-ink", compact ? "text-base" : "text-xl")}>MELO</div>
        <div className={cn("text-[10px] uppercase tracking-[0.3em] text-ink-soft", compact ? "text-[9px]" : "text-xs")}>Barbershop</div>
      </div>
    </div>
  );
}

export function PoleStripe({ className = "" }: { className?: string }) {
  return <div aria-hidden className={cn("pole h-2 w-full rounded-full opacity-80", className)} />;
}

export function Money({ value, className = "", signed = false }: { value: number; className?: string; signed?: boolean }) {
  return <span className={cn("tabular-nums", className)}>{cop(value)}</span>;
}

export const STATUS_META: Record<string, { label: string; cls: string }> = {
  RESERVED: { label: "Reservada", cls: "bg-brass/15 text-brass-dark border-brass/40" },
  CONFIRMED: { label: "Confirmada", cls: "bg-pole/10 text-pole border-pole/40" },
  IN_ATTENTION: { label: "En atención", cls: "bg-warn/15 text-warn border-warn/40" },
  COMPLETED: { label: "Completada", cls: "bg-good/15 text-good border-good/40" },
  CANCELLED: { label: "Cancelada", cls: "bg-melo/10 text-melo-dark border-melo/40" },
  NO_SHOW: { label: "Ausencia", cls: "bg-ink/10 text-ink-soft border-ink/30" },
};

export const PAY_STATUS_META: Record<string, { label: string; cls: string }> = {
  CONFIRMED: { label: "Confirmado", cls: "bg-good/15 text-good border-good/40" },
  PARTIALLY_REFUNDED: { label: "Dev. parcial", cls: "bg-warn/15 text-warn border-warn/40" },
  REFUNDED: { label: "Devuelto", cls: "bg-melo/15 text-melo-dark border-melo/40" },
};

export function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, cls: "bg-ink/10 text-ink border-ink/30" };
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", meta.cls)}>{meta.label}</span>;
}

export function Chip({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border border-ink/15 bg-ivory px-2 py-0.5 text-[11px] text-ink-soft", className)}>
      {children}
    </span>
  );
}

export function SectionTitle({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="font-display text-2xl font-bold text-ink">{title}</h2>
        {sub ? <p className="mt-1 text-sm text-ink-soft">{sub}</p> : null}
      </div>
      {right}
    </div>
  );
}

export function EmptyState({ icon, title, sub }: { icon?: React.ReactNode; title: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-ink/15 bg-ivory/60 px-6 py-10 text-center">
      {icon ? <div className="text-ink/40">{icon}</div> : null}
      <div className="font-medium text-ink">{title}</div>
      {sub ? <div className="max-w-md text-sm text-ink-soft">{sub}</div> : null}
    </div>
  );
}

export function LoadingBlock({ label = "Cargando…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-ink/10 bg-ivory px-6 py-8 text-ink-soft">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-brass border-t-transparent" />
      {label}
    </div>
  );
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-melo/30 bg-melo/5 px-6 py-6 text-melo-dark">
      <div className="font-medium">No se pudo cargar</div>
      <div className="mt-1 text-sm">{message}</div>
      {onRetry ? (
        <button onClick={onRetry} className="mt-3 rounded-lg bg-melo px-3 py-1.5 text-sm font-medium text-ivory hover:bg-melo-dark">
          Reintentar
        </button>
      ) : null}
    </div>
  );
}

export const METHOD_LABEL: Record<string, string> = {
  CASH: "Efectivo",
  TRANSFER: "Transferencia",
  CARD: "Tarjeta",
  OTHER: "Otro",
};

export const CATEGORY_LABEL: Record<string, string> = {
  ALQUILER: "Alquiler",
  INSUMOS: "Insumos",
  SERVICIOS: "Servicios (agua/luz/internet)",
  MANTENIMIENTO: "Mantenimiento",
  NOMINA_EXTRA: "Nómina extra",
  OTROS: "Otros",
};

// ============================================================ SINCRONIZACIÓN EN VIVO
// El panel del dueño y el sitio público viven en la misma página. Este hook
// re-renderiza el componente cada vez que la base de datos local cambia
// (barbero guardado, servicio creado, etc.), sin importar desde dónde se
// escribió. Así lo que se guarda aparece al instante en todas las vistas.
export function useMeloDB() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const h = () => setTick((n) => n + 1);
    window.addEventListener("melo:db-changed", h);
    window.addEventListener("storage", h); // cambios desde otra pestaña del mismo navegador
    return () => {
      window.removeEventListener("melo:db-changed", h);
      window.removeEventListener("storage", h);
    };
  }, []);
  return tick;
}
