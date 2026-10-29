import { NextResponse } from "next/server";
import { handle, ok } from "@/lib/http";
import { destroySession, SESSION_COOKIE } from "@/lib/auth";
import { cookies } from "next/headers";

export async function POST() {
  return handle(async () => {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    await destroySession(token);
    const res: NextResponse = ok({ loggedOut: true });
    res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    return res;
  });
}
