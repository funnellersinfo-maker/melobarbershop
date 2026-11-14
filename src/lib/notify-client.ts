"use client";
// Notificaciones push del navegador (Web Notifications API + sonidos sintetizados).
// - Sin backend: service worker mínimo permite notificar incluso con la pestaña cerrada
//   (mientras el navegador haya registrado el SW).
// - El administrador elige el sonido; se sintetiza con WebAudio (sin archivos).
import { getAdminData } from "@/lib/store";

export type NotifPermState = "granted" | "denied" | "default" | "unsupported";

export function notificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function permissionState(): NotifPermState {
  if (!notificationSupported()) return "unsupported";
  return Notification.permission as NotifPermState;
}

export async function ensureServiceWorker(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) {
      await navigator.serviceWorker.register("/sw.js");
    }
  } catch {
    /* el SW es un refuerzo; si falla, seguimos con notificaciones de página */
  }
}

export async function requestPermission(): Promise<NotifPermState> {
  if (!notificationSupported()) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission as NotifPermState;
  try {
    const result = await Notification.requestPermission();
    return result as NotifPermState;
  } catch {
    return "denied";
  }
}

// ---------- sonidos sintetizados ----------
type SoundName = "ding" | "chime" | "bell" | "pulse" | "none";

function playSoundWeb(name: SoundName) {
  if (name === "none") return;
  try {
    const Ctx = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.connect(ctx.destination);
    master.gain.value = 0.6;

    const tone = (freq: number, start: number, dur: number, type: OscillatorType = "sine", vol = 0.5) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(vol, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur);
      osc.connect(gain);
      gain.connect(master);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.05);
    };

    switch (name) {
      case "ding":
        tone(880, 0, 0.35);
        tone(1320, 0.08, 0.4, "sine", 0.35);
        break;
      case "chime":
        tone(523, 0, 0.4);
        tone(659, 0.12, 0.4);
        tone(784, 0.24, 0.5);
        break;
      case "bell":
        tone(987, 0, 0.6, "triangle");
        tone(1975, 0.01, 0.5, "sine", 0.2);
        break;
      case "pulse":
        tone(440, 0, 0.15, "square", 0.25);
        tone(440, 0.22, 0.15, "square", 0.25);
        tone(440, 0.44, 0.15, "square", 0.25);
        break;
    }
    setTimeout(() => ctx.close().catch(() => undefined), 1800);
  } catch {
    /* audio bloqueado por el navegador */
  }
}

export function currentSound(): SoundName {
  try {
    return getAdminData().notif.sound;
  } catch {
    return "ding";
  }
}

export function playPreviewSound(name: SoundName) {
  playSoundWeb(name);
}

function vibrateIfEnabled() {
  try {
    if (getAdminData().notif.vibrate && typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate([120, 60, 120]);
    }
  } catch {
    /* noop */
  }
}

// ---------- envío ----------
export async function pushNotify(title: string, options?: { body?: string; tag?: string; silent?: boolean }): Promise<void> {
  const state = permissionState();
  if (state !== "granted") return;
  const opts: NotificationOptions = {
    body: options?.body ?? "",
    tag: options?.tag,
    icon: "/melo-logo.png",
    badge: "/melo-logo.png",
  };
  try {
    let reg: ServiceWorkerRegistration | undefined;
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      reg = await navigator.serviceWorker.getRegistration();
    }
    if (reg) {
      await reg.showNotification(title, opts);
    } else {
      new Notification(title, opts);
    }
  } catch {
    try {
      new Notification(title, opts);
    } catch {
      /* ignore */
    }
  }
  if (!options?.silent) {
    playSoundWeb(currentSound());
    vibrateIfEnabled();
  }
}

// ---------- insistencia ----------
let listenerBound = false;

/** Registra el oyente global: atiende eventos de la app y repite la solicitud
 *  de permiso mientras el usuario no la haya concedido (ni bloqueado). */
export function setupNotificationPersistence(onStateChange?: (s: NotifPermState) => void) {
  if (typeof window === "undefined" || listenerBound) return;
  listenerBound = true;

  const report = () => onStateChange?.(permissionState());

  // evento interno de nuevas notificaciones
  window.addEventListener("melo:notification", (ev) => {
    const detail = (ev as CustomEvent<{ title: string; message: string; userId: string; type?: string }>).detail;
    void pushNotify(detail.title, { body: detail.message, tag: detail.type ?? "melo" });
  });

  // solicitar permiso reiteradamente hasta que se conceda o se deniegue explícitamente
  const tick = () => {
    const state = permissionState();
    report();
    if (state === "default") {
      void requestPermission().then(report);
    }
  };
  tick();
  window.setInterval(tick, 20_000); // recordatorio constante mientras no esté concedido
  document.addEventListener("visibilitychange", tick);
  window.addEventListener("pointerdown", () => {
    const state = permissionState();
    if (state === "default") void requestPermission().then(report);
  }, { once: false });
}

// ---------- banner para el dueño ----------
export function notificationsBlocked(): boolean {
  return permissionState() === "denied" || permissionState() === "unsupported";
}
