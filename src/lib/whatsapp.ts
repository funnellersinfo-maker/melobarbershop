// Integración de WhatsApp mediante WhatsApp Cloud API (o proveedor compatible).
// - Credenciales SOLO por variables de entorno; nunca se exponen en el navegador.
// - Sin credenciales: la agenda y las notificaciones internas siguen funcionando y
//   la integración se muestra como PENDIENTE_DE_CONFIGURACIÓN (nunca afirma envíos).
// - Protección contra duplicados por dedupKey, reintentos acotados (máx. 3) y
//   registro de identificadores de mensaje del proveedor.
import { db } from "@/lib/db";
import type { WhatsappMessage } from "@prisma/client";

export const MAX_ATTEMPTS = 3;

export type WhatsappConfig = {
  configured: boolean;
  provider: string;
  apiUrl: string;
  apiVersion: string;
  phoneNumberIdMasked: string | null;
  messageMode: "text" | "template";
};

export function getWhatsappConfig(): WhatsappConfig {
  const token = process.env.WHATSAPP_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const apiUrl = (process.env.WHATSAPP_API_URL?.trim() || "https://graph.facebook.com");
  const apiVersion = (process.env.WHATSAPP_API_VERSION?.trim() || "v22.0");
  const messageMode = (process.env.WHATSAPP_MESSAGE_MODE?.trim() === "template" ? "template" : "text") as "text" | "template";
  const configured = !!token && !!phoneNumberId;
  return {
    configured,
    provider: apiUrl.includes("graph.facebook.com") ? "WhatsApp Cloud API (Meta)" : "Proveedor compatible con Cloud API",
    apiUrl,
    apiVersion,
    phoneNumberIdMasked: phoneNumberId ? `${phoneNumberId.slice(0, 3)}••••${phoneNumberId.slice(-2)}` : null,
    messageMode,
  };
}

export function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length < 8) return null;
  return digits;
}

export function messageEndpoint(cfg: WhatsappConfig): string {
  return `${cfg.apiUrl}/${cfg.apiVersion}/${process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()}/messages`;
}

function buildPayload(cfg: WhatsappConfig, to: string, body: string, templateName?: string) {
  if (cfg.messageMode === "template" && templateName) {
    return {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: process.env.WHATSAPP_TEMPLATE_LANG?.trim() || "es" },
        components: [{ type: "body", parameters: [{ type: "text", text: body }] }],
      },
    };
  }
  return {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body },
  };
}

export const TEMPLATE_BY_TYPE: Record<string, string | undefined> = {
  CONFIRMATION: process.env.WHATSAPP_TEMPLATE_CONFIRMATION,
  REMINDER: process.env.WHATSAPP_TEMPLATE_REMINDER,
  STAFF_ALERT: process.env.WHATSAPP_TEMPLATE_STAFF_ALERT,
  CANCEL_NOTICE: process.env.WHATSAPP_TEMPLATE_CANCEL,
  TEST: process.env.WHATSAPP_TEMPLATE_TEST,
};

async function callProvider(cfg: WhatsappConfig, to: string, body: string, messageType: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const token = process.env.WHATSAPP_TOKEN?.trim();
  if (!token) return { ok: false, error: "WHATSAPP_TOKEN no configurado" };
  try {
    const res = await fetch(messageEndpoint(cfg), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(buildPayload(cfg, to, body, TEMPLATE_BY_TYPE[messageType])),
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 300)}` };
    }
    const json = JSON.parse(text) as { messages?: Array<{ id?: string }> };
    const id = json.messages?.[0]?.id;
    if (!id) return { ok: false, error: `Respuesta sin id de mensaje: ${text.slice(0, 300)}` };
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type SendMessageInput = {
  dedupKey: string;
  to?: string | null;
  messageType: string;
  body: string;
  appointmentId?: string | null;
  appointmentCode?: string | null;
};

export type SendResult = {
  status: WhatsappMessage["status"];
  record: WhatsappMessage | null;
  deduped: boolean;
};

/**
 * Envía (o deja pendiente) un mensaje de WhatsApp.
 * Idempotente por dedupKey: un mismo evento jamás se notifica dos veces.
 */
export async function sendMessage(input: SendMessageInput): Promise<SendResult> {
  const to = normalizePhone(input.to);
  const existing = await db.whatsappMessage.findUnique({ where: { dedupKey: input.dedupKey } });
  if (existing) return { status: existing.status, record: existing, deduped: true };

  const cfg = getWhatsappConfig();

  if (!to) {
    const rec = await db.whatsappMessage.create({
      data: {
        dedupKey: input.dedupKey,
        toPhone: input.to ?? "",
        messageType: input.messageType,
        body: input.body,
        status: "SKIPPED",
        error: "Sin número de teléfono",
        appointmentId: input.appointmentId ?? null,
        appointmentCode: input.appointmentCode ?? null,
      },
    });
    return { status: "SKIPPED", record: rec, deduped: false };
  }

  if (!cfg.configured) {
    const rec = await db.whatsappMessage.create({
      data: {
        dedupKey: input.dedupKey,
        toPhone: to,
        messageType: input.messageType,
        body: input.body,
        status: "PENDING_CONFIG",
        error: "Integración de WhatsApp pendiente de configuración (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID)",
        appointmentId: input.appointmentId ?? null,
        appointmentCode: input.appointmentCode ?? null,
      },
    });
    return { status: "PENDING_CONFIG", record: rec, deduped: false };
  }

  let rec = await db.whatsappMessage.create({
    data: {
      dedupKey: input.dedupKey,
      toPhone: to,
      messageType: input.messageType,
      body: input.body,
      status: "QUEUED",
      attempts: 0,
      appointmentId: input.appointmentId ?? null,
      appointmentCode: input.appointmentCode ?? null,
    },
  });

  rec = await attemptSend(rec.id, to, input.body, input.messageType);
  scheduleAutomaticRetry(rec, input.body, input.messageType);
  return { status: rec.status, record: rec, deduped: false };
}

async function attemptSend(recordId: string, to: string, body: string, messageType: string): Promise<WhatsappMessage> {
  const cfg = getWhatsappConfig();
  const attemptsRow = await db.whatsappMessage.findUnique({ where: { id: recordId } });
  const attempts = (attemptsRow?.attempts ?? 0) + 1;
  const result = await callProvider(cfg, to, body, messageType);

  if (result.ok) {
    return db.whatsappMessage.update({
      where: { id: recordId },
      data: { status: "SENT", providerMessageId: result.id, sentAt: new Date(), error: null, attempts },
    });
  }
  const final = attempts >= MAX_ATTEMPTS;
  return db.whatsappMessage.update({
    where: { id: recordId },
    data: {
      status: final ? "FAILED" : "QUEUED",
      error: result.error,
      attempts,
    },
  });
}

// Reintentos en proceso con espera creciente (2s / 8s). El barrido del
// programador cubre los mensajes que queden en cola tras un reinicio.
const inflight = new Set<string>();
function scheduleAutomaticRetry(rec: WhatsappMessage, body: string, messageType: string) {
  if (rec.status !== "QUEUED") return;
  const key = rec.dedupKey;
  if (inflight.has(key)) return;
  inflight.add(key);
  const delay = rec.attempts <= 1 ? 2000 : 8000;
  setTimeout(() => {
    inflight.delete(key);
    retryOne(rec.id, body, messageType).catch((e) => console.error("[whatsapp] reintento falló:", e));
  }, delay);
}

export async function retryOne(recordId: string, body: string, messageType: string): Promise<WhatsappMessage | null> {
  const rec = await db.whatsappMessage.findUnique({ where: { id: recordId } });
  if (!rec || rec.status !== "QUEUED") return rec;
  if (!getWhatsappConfig().configured) {
    return db.whatsappMessage.update({ where: { id: recordId }, data: { status: "PENDING_CONFIG" } });
  }
  const updated = await attemptSend(recordId, rec.toPhone, body, messageType);
  if (updated.status === "QUEUED") scheduleAutomaticRetry(updated, body, messageType);
  return updated;
}

/** Reintento manual (botón del panel): reencola FAILED/QUEUED. */
export async function retryQueue(): Promise<{ requeued: number }> {
  const rows = await db.whatsappMessage.findMany({
    where: { status: { in: ["QUEUED", "FAILED"] }, OR: [{ attempts: { lt: MAX_ATTEMPTS } }, { status: "FAILED" }] },
    take: 100,
  });
  let requeued = 0;
  for (const r of rows) {
    if (!getWhatsappConfig().configured) {
      await db.whatsappMessage.update({ where: { id: r.id }, data: { status: "PENDING_CONFIG", attempts: 0 } });
      continue;
    }
    await db.whatsappMessage.update({ where: { id: r.id }, data: { status: "QUEUED", attempts: 0 } });
    await retryOne(r.id, r.body, r.messageType);
    requeued++;
  }
  return { requeued };
}

export async function whatsappStatusSummary() {
  const cfg = getWhatsappConfig();
  const rows = await db.whatsappMessage.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  const counts = { SENT: 0, FAILED: 0, PENDING_CONFIG: 0, QUEUED: 0, SKIPPED: 0 } as Record<string, number>;
  const all = await db.whatsappMessage.findMany({ select: { status: true } });
  for (const r of all) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return { config: cfg, counts, recent: rows };
}
