import { handle, ok } from "@/lib/http";
import { getSessionUser } from "@/lib/auth";
import { sanitizeUser } from "@/lib/rbac";

export async function GET() {
  return handle(async () => {
    const user = await getSessionUser();
    return ok({ user: user ? sanitizeUser(user) : null });
  });
}
