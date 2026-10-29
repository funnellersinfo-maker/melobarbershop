// Registro de auditoría: toda modificación relevante queda con antes/después y autor.
import { db } from "@/lib/db";
import type { User } from "@prisma/client";

type AuditInput = {
  entity: string;
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
  user?: Pick<User, "id" | "name"> | null;
};

export function snapshot<T extends object>(obj: T | null | undefined): string | null {
  if (obj === null || obj === undefined) return null;
  return JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? Number(v) : v));
}

export async function audit(input: AuditInput): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        entity: input.entity,
        entityId: input.entityId,
        action: input.action,
        beforeJson: input.before === undefined ? undefined : snapshot(input.before),
        afterJson: input.after === undefined ? undefined : snapshot(input.after),
        userId: input.user?.id ?? null,
        userName: input.user?.name ?? "Sistema",
      },
    });
  } catch (err) {
    // la auditoría nunca debe romper la operación principal; queda en el log del servidor
    console.error("[audit] fallo registrando auditoría:", err);
  }
}
