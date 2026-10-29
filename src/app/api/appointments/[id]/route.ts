import { NextRequest } from "next/server";
import { handle, ok, ApiError } from "@/lib/http";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { assertTransition, withBookingLock } from "@/lib/booking";
import { createCommissionOnCompletion } from "@/lib/commission";
import { parseHM, timeHMInBogota, fmtDateMedium, dateKeyInBogota, dayStartUtc, dayOfWeekInBogota } from "@/lib/time";
import { audit, snapshot } from "@/lib/audit";
import { notifyBarberAndOwner } from "@/lib/notify";
import { sendMessage } from "@/lib/whatsapp";
import type { Appointment, Prisma } from "@prisma/client";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/appointments/:id
 *  - { action: "status", to, reason? }
 *  - { action: "complete", discount? }  -> COMPLETED + comisión con copia histórica (requisito C)
 *  - { action: "reschedule", date, time, barberId?, serviceId? }
 *  - { action: "notes", notes }
 * El barbero actúa solo sobre sus citas; el propietario sobre todas. Validado en servidor.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const body = (await req.json()) as {
      action?: string;
      to?: string;
      reason?: string;
      discount?: number;
      notes?: string;
      date?: string;
      time?: string;
      barberId?: string;
      serviceId?: string;
    };
    if (!body.action) throw new ApiError(400, "action es obligatorio");

    const appt = await db.appointment.findUnique({
      where: { id },
      include: { service: true, barber: { select: { id: true, name: true } } },
    });
    if (!appt) throw new ApiError(404, "Cita no encontrada");
    if (user.role !== "OWNER" && appt.barberId !== user.id) {
      throw new ApiError(403, "Solo puedes gestionar tus propias citas");
    }
    const before: Appointment = { ...appt };

    // ---------- notas ----------
    if (body.action === "notes") {
      const updated = await db.appointment.update({ where: { id }, data: { notes: body.notes?.trim() ?? null } });
      await audit({ entity: "APPOINTMENT", entityId: id, action: "UPDATE_NOTES", before: snapshot(before), after: snapshot(updated), user });
      return ok({ appointment: updated });
    }

    // ---------- reprogramar ----------
    if (body.action === "reschedule") {
      if (appt.status !== "RESERVED" && appt.status !== "CONFIRMED") {
        throw new ApiError(400, "Solo se pueden reprogramar citas reservadas o confirmadas");
      }
      if (!body.date || !DATE_RE.test(body.date) || !body.time || !TIME_RE.test(body.time)) {
        throw new ApiError(400, "date (YYYY-MM-DD) y time (HH:MM) son obligatorios");
      }
      const startMin = parseHM(body.time);
      const barberId = body.barberId ?? appt.barberId;
      const serviceId = body.serviceId ?? appt.serviceId;
      if (user.role !== "OWNER" && barberId !== user.id) {
        throw new ApiError(403, "No puedes reasignar la cita a otro barbero");
      }

      const updated = await withBookingLock(() =>
        db.$transaction(async (tx) => {
          const service = await tx.service.findUnique({ where: { id: serviceId } });
          if (!service || !service.active) throw new ApiError(400, "Servicio inválido o inactivo");
          const auth = await tx.barberService.findUnique({ where: { barberId_serviceId: { barberId, serviceId } } });
          if (!auth?.authorized) throw new ApiError(400, "El barbero no está autorizado para ese servicio");

          const dayStart = dayStartUtc(body.date!);
          const startTime = new Date(dayStart.getTime() + startMin * 60000);
          const endTime = new Date(startTime.getTime() + service.durationMin * 60000);
          const now = new Date();
          if (dateKeyInBogota(startTime) < dateKeyInBogota(now)) {
            throw new ApiError(400, "No se pueden reprogramar citas a días pasados");
          }

          const dayDow = dayOfWeekInBogota(startTime);
          const windows = await tx.availability.findMany({ where: { barberId, dayOfWeek: dayDow, active: true } });
          const covered = windows.some((w) => {
            const ws = parseHM(w.startTime);
            const we = parseHM(w.endTime);
            return startMin >= ws && startMin + service.durationMin <= we;
          });
          if (!covered) throw new ApiError(400, "La nueva hora no está dentro de la disponibilidad del barbero");

          const blocking = await tx.appointment.findMany({
            where: {
              barberId,
              status: { in: ["RESERVED", "CONFIRMED", "IN_ATTENTION", "COMPLETED"] },
              startTime: { lt: new Date(dayStart.getTime() + 24 * 3600 * 1000) },
              endTime: { gt: dayStart },
              id: { not: id },
            },
            select: { startTime: true, endTime: true },
          });
          const conflict = blocking.some((b) => startTime.getTime() < b.endTime.getTime() && b.startTime.getTime() < endTime.getTime());
          if (conflict) throw new ApiError(409, "El nuevo horario se cruza con otra cita del barbero");

          return tx.appointment.update({
            where: { id },
            data: {
              barberId,
              serviceId,
              startTime,
              endTime,
              // cambio de servicio: nueva copia de precio; mismo servicio: conserva la copia original
              priceSnapshot: serviceId !== appt.serviceId ? service.price : appt.priceSnapshot,
            },
          });
        })
      );

      await audit({ entity: "APPOINTMENT", entityId: id, action: "RESCHEDULE", before: snapshot(before), after: snapshot(updated), user });
      await notifyBarberAndOwner(
        updated.barberId,
        {
          type: "appointment.updated",
          title: "Cita reprogramada",
          message: `${appt.code} movida a ${fmtDateMedium(updated.startTime)} ${timeHMInBogota(updated.startTime)} por ${user.name}`,
          metadata: { key: `${id}:reschedule:${updated.startTime.toISOString()}`, appointmentId: id },
        },
        `MELO BARBERSHOP: tu cita ${appt.code} se reprogramó para ${fmtDateMedium(updated.startTime)} ${timeHMInBogota(updated.startTime)}.`
      );
      await sendMessage({
        dedupKey: `reschedule:${id}:${updated.startTime.toISOString()}`,
        to: updated.clientPhone,
        messageType: "CONFIRMATION",
        body: `MELO BARBERSHOP: tu cita ${appt.code} fue reprogramada. Nueva hora: ${fmtDateMedium(updated.startTime)} ${timeHMInBogota(updated.startTime)} con ${appt.barber.name}.`,
        appointmentId: id,
        appointmentCode: appt.code,
      });
      return ok({ appointment: updated });
    }

    // ---------- completar ----------
    if (body.action === "complete") {
      if (appt.status !== "IN_ATTENTION") {
        throw new ApiError(400, "La cita debe estar EN ATENCIÓN para completarse (flujo B)");
      }
      const discount = Math.max(0, Math.round(body.discount ?? 0));
      if (discount > appt.priceSnapshot) throw new ApiError(400, "El descuento supera el precio de la cita");

      const result = await db.$transaction(async (tx) => {
        const updated = await tx.appointment.update({
          where: { id },
          data: { status: "COMPLETED", discount, completedAt: new Date() },
        });
        const commission = await createCommissionOnCompletion(tx, updated, discount);
        return { updated, commission };
      });

      await audit({ entity: "APPOINTMENT", entityId: id, action: "COMPLETE", before: snapshot(before), after: snapshot(result.updated), user });
      await audit({ entity: "COMMISSION", entityId: result.commission.id, action: "CREATE_ON_COMPLETION", after: snapshot(result.commission), user });

      await notifyBarberAndOwner(
        appt.barberId,
        {
          type: "appointment.completed",
          title: "Servicio completado",
          message: `${appt.code} · ${appt.service.name} · ${appt.clientName} · listo para registrar el pago`,
          metadata: { key: `${id}:completed`, appointmentId: id },
        },
        `MELO BARBERSHOP: servicio completado (${appt.service.name}). Registra el pago cuando lo recibas.`
      );
      if (!result.commission.configured) {
        await notifyBarberAndOwner(appt.barberId, {
          type: "commission.pending_config",
          title: "Comisión sin configurar",
          message: `${appt.code} se completó sin regla de comisión vigente. Configura las comisiones o define el valor manualmente.`,
          metadata: { key: `${id}:noconfig`, appointmentId: id },
        });
      }
      return ok({ appointment: result.updated, commission: result.commission });
    }

    // ---------- cambio de estado ----------
    if (body.action === "status") {
      const to = body.to ?? "";
      if (to === "COMPLETED") throw new ApiError(400, "Use action=complete para completar la cita");
      assertTransition(appt.status, to);
      const patch: Prisma.AppointmentUpdateInput = { status: to };
      if (to === "CANCELLED") patch.cancelReason = body.reason?.trim() || "Sin motivo registrado";

      const updated = await db.appointment.update({ where: { id }, data: patch });
      await audit({ entity: "APPOINTMENT", entityId: id, action: `STATUS_${to}`, before: snapshot(before), after: snapshot(updated), user });

      const when = `${fmtDateMedium(appt.startTime)} ${timeHMInBogota(appt.startTime)}`;
      const eventKey = `${id}:${to}:${Date.now()}`;
      if (to === "CANCELLED") {
        await notifyBarberAndOwner(
          appt.barberId,
          {
            type: "appointment.cancelled",
            title: "Cita cancelada",
            message: `${appt.code} · ${appt.clientName} · ${when} · motivo: ${updated.cancelReason ?? "-"}`,
            metadata: { key: eventKey, appointmentId: id },
          },
          `MELO BARBERSHOP: la cita ${appt.code} (${when}) fue cancelada.`
        );
        await sendMessage({
          dedupKey: `cancel:${eventKey}`,
          to: appt.clientPhone,
          messageType: "CANCEL_NOTICE",
          body: `MELO BARBERSHOP: tu cita ${appt.code} del ${when} fue cancelada. Puedes reservar de nuevo cuando quieras.`,
          appointmentId: id,
          appointmentCode: appt.code,
        });
      } else if (to === "NO_SHOW") {
        await notifyBarberAndOwner(
          appt.barberId,
          {
            type: "appointment.noshow",
            title: "Ausencia del cliente",
            message: `${appt.code} · ${appt.clientName} · ${when} · marcada por ${user.name}`,
            metadata: { key: eventKey, appointmentId: id },
          },
          `MELO BARBERSHOP: el cliente no asistió a la cita ${appt.code} (${when}).`
        );
      } else {
        await notifyBarberAndOwner(
          appt.barberId,
          {
            type: "appointment.status",
            title: `Cita ${to === "CONFIRMED" ? "confirmada" : "en atención"}`,
            message: `${appt.code} · ${appt.clientName} · ${when}`,
            metadata: { key: eventKey, appointmentId: id },
          },
          `MELO BARBERSHOP: la cita ${appt.code} (${when}) ahora está ${to === "CONFIRMED" ? "confirmada" : "en atención"}.`
        );
      }
      return ok({ appointment: updated });
    }

    throw new ApiError(400, `Acción desconocida: ${body.action}`);
  });
}
