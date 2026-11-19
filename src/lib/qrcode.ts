"use client";
// ============================================================ CÓDIGOS QR DE LA BARBERÍA
// Wrapper sobre la librería "qrcode" (offline, sin llamadas de red): genera el
// QR en un canvas con el logo del perrito en el centro (nivel Q = 25% de
// corrección de errores, suficiente para el hueco del logo) y permite
// descargarlo como PNG para imprimir o compartir.

import QRCode from "qrcode";

export const QR_LOGO_SRC = "/melo-logo.png";

/**
 * Dibuja el QR de `text` en `canvas` con margen blanco y el logo del perrito
 * al centro (22% del lado con halo blanco). Nivel Q para que el logo no rompa
 * la lectura. `scale` controla la nitidez (12 = nítido al proyectar en pantalla).
 */
export async function drawQrToCanvas(
  canvas: HTMLCanvasElement,
  text: string,
  opts: { logoSrc?: string; scale?: number } = {},
): Promise<void> {
  const scale = opts.scale ?? 12;
  const logoSrc = opts.logoSrc ?? QR_LOGO_SRC;

  // QR base con margen 2 (módulos) — la librería dibuja módulo a módulo
  await QRCode.toCanvas(canvas, text, {
    errorCorrectionLevel: "Q",
    margin: 2,
    scale,
    color: { dark: "#1a1512", light: "#ffffff" },
    width: undefined,
  });
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const px = canvas.width;

  // logo del perrito al centro: halo blanco + recorte circular
  await new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const logoSize = Math.floor(px * 0.22);
      const x = (px - logoSize) / 2;
      // halo: círculo blanco un poco mayor que el logo
      ctx.save();
      ctx.beginPath();
      ctx.arc(px / 2, px / 2, logoSize / 2 + logoSize * 0.12, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      // logo con recorte circular
      ctx.beginPath();
      ctx.arc(px / 2, px / 2, logoSize / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(img, x, x, logoSize, logoSize);
      ctx.restore();
      resolve();
    };
    img.onerror = () => resolve(); // sin logo: el QR queda funcional igual
    img.src = logoSrc;
  });
}

/** Descarga el canvas como PNG con nombre limpio. */
export function downloadCanvasPng(canvas: HTMLCanvasElement, filename: string): void {
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = filename.endsWith(".png") ? filename : `${filename}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** URL base del sitio (sin hash ni query): https://melobarbershop.pages.dev */
export function siteBaseUrl(): string {
  return `${window.location.protocol}//${window.location.host}`;
}

/** Link directo para reservar (abre el wizard al cargar). */
export function bookingLink(): string {
  return `${siteBaseUrl()}/?reservar=1`;
}

/** Link de reseñas del barbero por su código público. */
export function reviewLink(reviewCode: string): string {
  return `${siteBaseUrl()}/?r=${encodeURIComponent(reviewCode)}`;
}
