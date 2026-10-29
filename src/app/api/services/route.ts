import { NextRequest } from "next/server";
import { handle, ok, ApiError, requireFields } from "@/lib/http";
import { db } from "@/lib/db";
import { requireOwner } from "@/lib/auth";
import { audit, snapshot } from "@/lib/audit";

export async function GET(_req: NextRequest) {
  return handle(async () => {
    await requireOwner();
    const services = await db.service.findMany({ orderBy: { sortOrder: "asc" } });
    return ok({ services });
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireOwner();
    const body = (await req.json()) as {
      name?: string;
      description?: string;
      price?: number;
      durationMin?: number;
      sortOrder?: number;
    };
    requireFields(body, ["name", "price", "durationMin"]);
    const price = Math.round(Number(body.price));
    const durationMin = Math.round(Number(body.durationMin));
    if (price <= 0) throw new ApiError(400, "El precio debe ser mayor que cero");
    if (durationMin < 10 || durationMin > 300) throw new ApiError(400, "La duración debe estar entre 10 y 300 minutos");

    const maxOrder = await db.service.aggregate({ _max: { sortOrder: true } });
    const service = await db.service.create({
      data: {
        name: body.name!.trim(),
        description: body.description?.trim() || null,
        price,
        durationMin,
        sortOrder: body.sortOrder ?? (maxOrder._max.sortOrder ?? 0) + 1,
      },
    });
    await audit({ entity: "SERVICE", entityId: service.id, action: "CREATE", after: snapshot(service), user });
    return ok({ service }, 201);
  });
}
