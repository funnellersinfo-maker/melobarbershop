import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/http";
import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

/**
 * GET: historial de modificaciones (auditoría) — requisito D.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireOwner();
    const url = new URL(req.url);
    const entity = url.searchParams.get("entity");
    const take = Math.min(500, Number(url.searchParams.get("take") ?? 200) || 200);
    const where: Prisma.AuditLogWhereInput = {};
    if (entity) where.entity = entity;

    const logs = await db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
    });
    return ok({ logs });
  });
}
