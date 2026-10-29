import { NextRequest } from "next/server";
import { handle, ok, ApiError, requireFields } from "@/lib/http";
import { db } from "@/lib/db";
import { createValidatedAppointment, pickBarberForAny, withBookingLock } from "@/lib/booking";
import { dateKeyInBogota, parseHM, timeHMInBogota, fmtDateMedium } from "@/lib/time";
import { audit } from "@/lib/audit";
import { notifyBarberAndOwner } from "@/lib/notify";
import { sendMessage } from "@/lib/whatsapp";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

/**
 * Reserva pública (requisito F): sin acceso al panel privado.
 * El barbero asignado se elige entre los disponibles (balanceo por carga del día).
 * La confirmación por WhatsApp se envía solo si hay teléfono y la integración
 * está configurada; si no, queda PENDING_CONFIG sin afirmar envíos.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const body = (await req.json()) as {
      serviceId?: string;
      date?: string;
      time?: string;
      barberId?: string | null; // null/"ANY" = sin preferencia
      clientName?: string;
      clientPhone?: string;
      clientEmail?: string;
    };
    requireFields(body, ["serviceId", "date", "time", "clientName"]);
    if (!DATE_RE.test(body.date!)) throw new ApiError(400, "date debe ser YYYY-MM-DD");
    if (!TIME_RE.test(body.time!)) throw new ApiError(400, "time debe ser HH:MM");
    if (body.clientName!.trim().length < 2) throw new ApiError(400, "Nombre del cliente inválido");
    if (body.clientEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.clientEmail.trim())) {
      throw new ApiError(400, "Correo inválido");
    }

    const startMin = parseHM(body.time!);
    const service = await db.service.findUnique({ where: { id: body.serviceId! } });
    if (!service || !service.active) throw new ApiError(404, "Servicio no encontrado o inactivo");

    const created = await withBookingLock(async () => {
      return db.$transaction(async (tx) => {
        const wantedBarber = body.barberId && body.barberId !== "ANY" ? body.barberId : null;
        const barberId = wantedBarber ?? (await pickBarberForAny(tx, body.serviceId!, body.date!, startMin, service.durationMin));
        return createValidatedAppointment(tx, {
          barberId,
          serviceId: body.serviceId!,
          dateKey: body.date!,
          startMin,
          clientName: body.clientName!,
          clientPhone: body.clientPhone ?? null,
          clientEmail: body.clientEmail ?? null,
          origin: "PUBLIC",
          createdById: null,
        });
      });
    });

    await audit({
      entity: "APPOINTMENT",
      entityId: created.id,
      action: "CREATE_PUBLIC",
      after: created,
      user: null,
    });

    const when = `${fmtDateMedium(created.startTime)} ${timeHMInBogota(created.startTime)}`;
    const barber = await db.user.findUnique({ where: { id: created.barberId } });

    await notifyBarberAndOwner(
      created.barberId,
      {
        type: "appointment.created",
        title: "Nueva reserva web",
        message: `${service.name} · ${created.clientName} · ${when} · ${barber?.name ?? ""} · código ${created.code}`,
        metadata: { key: `${created.id}:created`, appointmentId: created.id },
      },
      `MELO BARBERSHOP: nueva reserva web de ${created.clientName} (${service.name}) el ${when}.`
    );

    await sendMessage({
      dedupKey: `booking:${created.id}:client`,
      to: created.clientPhone,
      messageType: "CONFIRMATION",
      body: `MELO BARBERSHOP: tu cita quedó reservada. ${service.name} con ${barber?.name ?? "tu barbero"} el ${when}. Código ${created.code}. ¡Te esperamos!`,
      appointmentId: created.id,
      appointmentCode: created.code,
    });

    return ok(
      {
        appointment: {
          code: created.code,
          status: created.status,
          service: service.name,
          price: created.priceSnapshot,
          barber: barber?.name ?? "",
          date: body.date,
          time: body.time,
          durationMin: service.durationMin,
        },
      },
      201
    );
  });
}
