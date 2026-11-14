"use client";
// MELO BARBERSHOP — confeti dopaminérgico reutilizable (registro + tour).
import { useMemo } from "react";

const COLORS = ["#a63d40", "#c9a227", "#3f5d7d", "#f5f0e6", "#2b6e4f", "#d97b29"];

export function Confetti({ count = 90, durationMs = 2600 }: { count?: number; durationMs?: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 500,
        duration: durationMs * (0.55 + Math.random() * 0.6),
        size: 6 + Math.random() * 7,
        color: COLORS[i % COLORS.length],
        rotate: Math.random() * 360,
        round: Math.random() > 0.6,
        drift: (Math.random() - 0.5) * 160,
      })),
    [count, durationMs]
  );

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[120] overflow-hidden">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="confetti-piece"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size * (p.round ? 1 : 1.6),
            background: p.color,
            borderRadius: p.round ? "50%" : "2px",
            animationDelay: `${p.delay}ms`,
            animationDuration: `${p.duration}ms`,
            transform: `rotate(${p.rotate}deg)`,
            ["--drift" as string]: `${p.drift}px`,
          }}
        />
      ))}
    </div>
  );
}
