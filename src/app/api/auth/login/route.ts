import { NextRequest, NextResponse } from "next/server";
import { handle, ok, requireFields } from "@/lib/http";
import { login, SESSION_COOKIE } from "@/lib/auth";
import { sanitizeUser } from "@/lib/rbac";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const body = (await req.json()) as { email?: string; password?: string };
    requireFields(body, ["email", "password"]);
    const { token, expiresAt } = await login(body.email!, body.password!);
    const user = await db.user.findUnique({ where: { email: body.email!.trim().toLowerCase() } });
    const res: NextResponse = ok({ user: user ? sanitizeUser(user) : null });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: expiresAt,
    });
    return res;
  });
}
