"use client";
// ============================================================ TARJETA DE COMPARTIR (QR)
// QR con el logo del perrito al centro + link corto copiable + descarga PNG +
// modo pantalla completa para mostrarlo desde el celular. Se usa en el panel
// del dueño (reservas) y en el perfil de cada barbero (reservas + reseñas).

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { drawQrToCanvas, downloadCanvasPng } from "@/lib/qrcode";
import { Copy, Download, Maximize2, X } from "lucide-react";

export function QrShareCard({
  title,
  subtitle,
  url,
  filename,
  accent = "brass",
}: {
  title: string;
  subtitle?: string;
  url: string;
  filename: string;
  accent?: "brass" | "ink";
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    const c = canvasRef.current;
    if (!c) return;
    void drawQrToCanvas(c, url).then(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, [url]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copiado", description: "Ya lo puedes pegar en WhatsApp o donde quieras." });
    } catch {
      // navegadores sin clipboard API: seleccionar el input manualmente
      toast({ title: "Copia el link", description: "Mantén presionado el campo para copiar." });
    }
  }

  function download() {
    const c = canvasRef.current;
    if (!c || !ready) return;
    downloadCanvasPng(c, filename);
  }

  const qrBox = (
    <canvas
      ref={canvasRef}
      className={cn("h-auto w-full max-w-[280px] rounded-2xl border border-ink/10 bg-white shadow-sm", !ready && "opacity-0")}
      aria-label={`Código QR: ${title}`}
    />
  );

  return (
    <div className="flex flex-col gap-3 rounded-3xl border border-ink/10 bg-ivory p-5 shadow-sm">
      <div>
        <div className="font-display text-base font-bold">{title}</div>
        {subtitle ? <div className="mt-0.5 text-xs text-ink-soft">{subtitle}</div> : null}
      </div>

      <div className="flex justify-center">{qrBox}</div>

      <div className="flex gap-2">
        <Input readOnly value={url} className="h-9 flex-1 border-ink/15 bg-white text-[11px] text-ink-soft" onFocus={(e) => e.currentTarget.select()} aria-label="Link para compartir" />
        <Button size="icon" variant="outline" className="h-9 w-9 shrink-0 border-ink/15" onClick={copyLink} aria-label="Copiar link">
          <Copy className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className={cn("border-ink/20", accent === "brass" ? "text-brass-dark hover:bg-brass/10" : "text-ink hover:bg-ink/5")} onClick={download}>
          <Download className="mr-1.5 h-4 w-4" /> Descargar QR
        </Button>
        <Button size="sm" variant="outline" className="border-ink/20 text-ink hover:bg-ink/5" onClick={() => setFullscreen(true)}>
          <Maximize2 className="mr-1.5 h-4 w-4" /> Mostrar en pantalla
        </Button>
      </div>

      {/* pantalla completa: para mostrar el QR desde el celular al cliente */}
      {fullscreen ? (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-ink/95 p-6" onClick={() => setFullscreen(false)}>
          <button className="absolute right-4 top-4 rounded-full bg-cream/10 p-2 text-cream" aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
          <canvas
            ref={(el) => { if (el) void drawQrToCanvas(el, url, { scale: 16 }); }}
            className="h-auto w-full max-w-[min(85vw,520px)] rounded-3xl bg-white p-2"
            aria-label={`Código QR grande: ${title}`}
          />
          <div className="mt-4 text-center text-sm text-cream/80">
            <div className="font-display text-base font-bold text-cream">{title}</div>
            <div className="mt-1 opacity-70">Toca cualquier parte para cerrar</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
