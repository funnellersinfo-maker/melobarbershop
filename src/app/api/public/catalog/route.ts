import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/http";
import { db } from "@/lib/db";

// Catálogo público: servicios activos y barberos activos (sin datos privados).
export async function GET(_req: NextRequest) {
  return handle(async () => {
    const [services, barbers] = await Promise.all([
      db.service.findMany({
        where: { active: true },
        orderBy: { sortOrder: "asc" },
        select: { id: true, name: true, description: true, price: true, durationMin: true },
      }),
      db.user.findMany({
        where: { role: "BARBER", active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);
    return ok({ services, barbers });
  });
}
