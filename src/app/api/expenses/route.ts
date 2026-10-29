import { NextRequest } from "next/server";
import { handle, ok, ApiError, requireFields } from "@/lib/http";
import { db } from "@/lib/db";
import { requireOwner } from "@/lib/auth";
import { audit, snapshot } from "@/lib/audit";
import { dayStartUtc } from "@/lib/time";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CATEGORIES = ["ALQUILER", "INSUMOS", "SERVICIOS", "MANTENIMIENTO", "NOMINA_EXTRA", "OTROS"];

export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireOwner();
    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const where: Record<string, unknown> = {};
    if (from && DATE_RE.test(from)) where.spentAt = { ...(where.spentAt as object), gte: dayStartUtc(from) };
    if (to && DATE_RE.test(to)) where.spentAt = { ...(where.spentAt as object), lt: new Date(dayStartUtc(to).getTime() + 24 * 3600 * 1000) };

    const expenses = await db.expense.findMany({
      where,
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: { spentAt: "desc" },
      take: 500,
    });
    return ok({ expenses, categories: CATEGORIES });
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireOwner();
    const body = (await req.json()) as {
      description?: string;
      category?: string;
      amount?: number;
      method?: string;
      notes?: string;
      date?: string;
    };
    requireFields(body, ["description", "category", "amount"]);
    if (!CATEGORIES.includes(body.category!)) throw new ApiError(400, `Categoría inválida: ${CATEGORIES.join(", ")}`);
    const amount = Math.round(Number(body.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw new ApiError(400, "El monto debe ser mayor que cero");

    const spentAt = body.date && DATE_RE.test(body.date) ? dayStartUtc(body.date) : new Date();
    const expense = await db.expense.create({
      data: {
        description: body.description!.trim(),
        category: body.category!,
        amount,
        method: body.method?.toUpperCase() ?? null,
        notes: body.notes?.trim() || null,
        spentAt,
        createdById: user.id,
      },
    });
    await audit({ entity: "EXPENSE", entityId: expense.id, action: "CREATE", after: snapshot(expense), user });
    return ok({ expense }, 201);
  });
}
