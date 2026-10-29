// Programador interno: recordatorios de citas próximas y barrido de reintentos
// de WhatsApp. Se inicia desde src/instrumentation.ts (runtime nodejs).
import { db } from "@/lib/db";
import { dateKeyInBogota, timeHMInBogota, fmtDateMedium } from "@/lib/time";
import { sendMessage, retryOne, getWhatsappConfig } from "@/lib/whatsapp";
import { getOwnerUsers, notifyUsers } from "@/lib/notify";

const REMINDER_WINDOW_MS = 2 * 3600 * 1000; // 2 horas antes

export async function runReminderSweep() {
  const now = new Date();
  const horizon = new Date(now.getTime() + REMINDER_WINDOW_MS);
  const upcoming = await db.appointment.findMany({
    where: {
      status: { in: ["RESERVED", "CONFIRMED"] },
      startTime: { gte: now, lt: horizon },
    },
    include: { barber: { select: { id: true, name: true } }, service: { select: { name: true } } },
    take: 50,
  });

  for (const a of upcoming) {
    const dayKey = dateKeyInBogota(a.startTime);
    // dedupKey único por cita y día: el recordatorio no se repite
    const dedupKey = `reminder:${a.id}:${dayKey}`;
    const existing = await db.whatsappMessage.findUnique({ where: { dedupKey } });
    if (existing) continue;

    const when = `${fmtDateMedium(a.startTime)} ${timeHMInBogota(a.startTime)}`;
    const body = `MELO BARBERSHOP: recordatorio de tu cita ${a.service.name} con ${a.barber.name} el ${when}. Código ${a.code}.`;
    await sendMessage({
      dedupKey,
      to: a.clientPhone,
      messageType: "REMINDER",
      body,
      appointmentId: a.id,
      appointmentCode: a.code,
    });

    const owners = await getOwnerUsers();
    await notifyUsers([a.barberId, ...owners.map((o) => o.id)], {
      type: "appointment.upcoming",
      title: "Cita próxima",
      message: `${a.service.name} · ${a.clientName} · ${when} (${a.barber.name}) · código ${a.code}`,
      metadata: { key: `${a.id}:${dayKey}`, appointmentId: a.id },
    });
  }
}

export async function runWhatsappRetrySweep() {
  if (!getWhatsappConfig().configured) return;
  const stuck = await db.whatsappMessage.findMany({
    where: { status: "QUEUED" },
    take: 50,
  });
  for (const m of stuck) {
    if (m.attempts >= 3) {
      await db.whatsappMessage.update({ where: { id: m.id }, data: { status: "FAILED" } });
      continue;
    }
    await retryOne(m.id, m.body, m.messageType);
  }
}

export function startScheduler() {
  const g = globalThis as unknown as { __meloSchedulerStarted?: boolean };
  if (g.__meloSchedulerStarted) return;
  g.__meloSchedulerStarted = true;

  const tick = async () => {
    try {
      await runReminderSweep();
      await runWhatsappRetrySweep();
    } catch (err) {
      console.error("[scheduler] barrido falló:", err);
    }
  };
  void tick();
  const timer = setInterval(tick, 60 * 1000);
  if (typeof timer.unref === "function") timer.unref();
  console.log("[scheduler] programador iniciado (recordatorios + reintentos WhatsApp cada 60s)");
}
