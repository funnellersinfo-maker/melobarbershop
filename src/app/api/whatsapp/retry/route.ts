import { handle, ok } from "@/lib/http";
import { requireOwner } from "@/lib/auth";
import { retryQueue } from "@/lib/whatsapp";

/** POST: reintentar mensajes fallidos o en cola (controlado, máx. 3 intentos). */
export async function POST() {
  return handle(async () => {
    await requireOwner();
    const result = await retryQueue();
    return ok(result);
  });
}
