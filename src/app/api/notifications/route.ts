import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/http";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export async function GET(_req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const notifications = await db.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const unread = notifications.filter((n) => !n.read).length;
    return ok({ notifications, unread });
  });
}

export async function POST(_req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const res = await db.notification.updateMany({ where: { userId: user.id, read: false }, data: { read: true } });
    return ok({ marked: res.count });
  });
}
