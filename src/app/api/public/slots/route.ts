import { NextRequest } from "next/server";
import { handle, ok, ApiError } from "@/lib/http";
import { db } from "@/lib/db";
import {
  windowsForDate,
  blockingAppointments,
  slotsInWindows,
  minLeadStartMin,
  SLOT_STEP,
} from "@/lib/booking";
import { dayStartUtc, dateKeyInBogota, dayOfWeekInBogota } from "@/lib/time";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Horarios disponibles para una fecha/servicio.
 * barberId vacío o "ANY": unión de todos los barberos autorizados (sin preferencia).
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const url = new URL(req.url);
    const serviceId = url.searchParams.get("serviceId") ?? "";
    const date = url.searchParams.get("date") ?? "";
    const rawBarber = (url.searchParams.get("barberId") ?? "ANY").trim();
    const barberParam = rawBarber === "" || rawBarber.toUpperCase() === "ANY" ? "ANY" : rawBarber;
    if (!serviceId) throw new ApiError(400, "serviceId es obligatorio");
    if (!DATE_RE.test(date)) throw new ApiError(400, "date debe ser YYYY-MM-DD");
    if (date < dateKeyInBogota(new Date())) throw new ApiError(400, "No se pueden consultar horarios de días pasados");

    const service = await db.service.findUnique({ where: { id: serviceId } });
    if (!service || !service.active) throw new ApiError(404, "Servicio no encontrado o inactivo");

    const dayStart = dayStartUtc(date);
    const dow = dayOfWeekInBogota(dayStart);

    let barberIds: string[] = [];
    if (barberParam !== "ANY") {
      const barber = await db.user.findUnique({ where: { id: barberParam } });
      if (!barber || barber.role !== "BARBER" || !barber.active) throw new ApiError(404, "Barbero no encontrado o inactivo");
      const auth = await db.barberService.findUnique({
        where: { barberId_serviceId: { barberId: barberParam, serviceId } },
      });
      if (!auth?.authorized) throw new ApiError(400, "El barbero no está autorizado para este servicio");
      barberIds = [barberParam];
    } else {
      const auths = await db.barberService.findMany({
        where: { serviceId, authorized: true },
        include: { barber: { select: { id: true, active: true, role: true } } },
      });
      barberIds = auths.filter((a) => a.barber.active).map((a) => a.barberId);
    }
    if (barberIds.length === 0) throw new ApiError(409, "Ningún barbero disponible para este servicio");

    const windows = await windowsForDate(barberIds, date);
    const now = new Date();
    const isToday = date === dateKeyInBogota(now);
    const minStart = isToday ? minLeadStartMin(now, dayStart) : 0;

    const byBarber = new Map<string, { startTime: Date; endTime: Date }[]>();
    for (const id of barberIds) {
      byBarber.set(id, await blockingAppointments(db, id, dayStart, new Date(dayStart.getTime() + 24 * 3600 * 1000)));
    }

    // slots por barbero, unión para ANY; cada slot indica qué barberos quedan libres
    const slotMap = new Map<number, { time: string; barbers: string[] }>();
    for (const id of barberIds) {
      const barberWindows = windows.filter((w) => w.barberId === id);
      const slots = slotsInWindows(barberWindows, service.durationMin, byBarber.get(id) ?? [], dayStart, minStart);
      for (const s of slots) {
        const cur = slotMap.get(s.startMin);
        if (cur) cur.barbers.push(id);
        else slotMap.set(s.startMin, { time: s.time, barbers: [id] });
      }
    }

    const slots = Array.from(slotMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([startMin, v]) => ({ time: v.time, startMin, barbers: v.barbers }));

    return ok({
      date,
      serviceId,
      serviceName: service.name,
      durationMin: service.durationMin,
      price: service.price,
      stepMin: SLOT_STEP,
      slots,
    });
  });
}
