// Notificaciones internas (en la base de datos, siempre funcionan aunque WhatsApp
// no esté configurado) y despacho opcional de alertas por WhatsApp al personal.
import { db } from "@/lib/db";
import { sendMessage } from "@/lib/whatsapp";
import type { User } from "@prisma/client";

type NotifyInput = {
  type: string;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
};

export async function getOwnerUsers(): Promise<User[]> {
  return db.user.findMany({ where: { role: "OWNER", active: true } });
}

export async function notifyUsers(userIds: string[], input: NotifyInput) {
  if (userIds.length === 0) return;
  await db.notification.createMany({
    data: userIds.map((userId) => ({
      type: input.type,
      title: input.title,
      message: input.message,
      userId,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
    })),
  });
}

export async function notifyOwners(input: NotifyInput) {
  const owners = await getOwnerUsers();
  await notifyUsers(owners.map((o) => o.id), input);
  return owners;
}

/** Notifica al barbero implicado y al propietario. WhatsApp al personal solo si
 *  el usuario lo tiene activado y la integración está configurada. */
export async function notifyBarberAndOwner(barberId: string, input: NotifyInput, whatsappBody?: string) {
  const barber = await db.user.findUnique({ where: { id: barberId } });
  const owners = await getOwnerUsers();
  const targets = [barber, ...owners].filter(Boolean) as User[];
  await notifyUsers(
    targets.map((u) => u.id),
    input
  );
  if (whatsappBody) {
    for (const u of targets) {
      if (u.notifyWhatsapp && u.phone && u.role === "BARBER") {
        await sendMessage({
          dedupKey: `staff:${input.type}:${u.id}:${input.metadata?.key ?? ""}`,
          to: u.phone,
          messageType: "STAFF_ALERT",
          body: whatsappBody,
        });
      }
    }
  }
  return targets;
}

/** Notificación de evento financiero autorizado (pagos, liquidaciones, ajustes). */
export async function notifyFinancialEvent(input: NotifyInput & { barberId?: string | null }) {
  const owners = await getOwnerUsers();
  const ids = new Set(owners.map((o) => o.id));
  if (input.barberId) {
    const barber = await db.user.findUnique({ where: { id: input.barberId } });
    if (barber) ids.add(barber.id);
  }
  await notifyUsers(Array.from(ids), input);
}
