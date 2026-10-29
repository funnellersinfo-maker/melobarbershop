// Helpers HTTP para route handlers: errores tipados, respuestas y envoltura try/catch.
import { NextResponse } from "next/server";

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data as object, { status });
}

export function fail(status: number, message: string, details?: unknown) {
  return NextResponse.json({ error: message, details: details ?? null }, { status });
}

export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError) return fail(err.status, err.message, err.details);
    console.error("[api] error no controlado:", err);
    const message = err instanceof Error ? err.message : "Error interno";
    return fail(500, `Error interno: ${message}`);
  }
}

export function parseIntParam(v: string | null | undefined, name: string): number {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new ApiError(400, `Parámetro inválido: ${name}`);
  return n;
}

export function requireFields<T extends object>(obj: T, fields: (keyof T & string)[]) {
  const missing = fields.filter((f) => {
    const v = (obj as Record<string, unknown>)[f];
    return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
  });
  if (missing.length) throw new ApiError(400, `Faltan campos obligatorios: ${missing.join(", ")}`);
}
