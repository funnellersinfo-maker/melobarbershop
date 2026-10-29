import { handle, ok } from "@/lib/http";
import { whatsappStatusSummary } from "@/lib/whatsapp";

/**
 * GET: estado de la integración de WhatsApp (requisito G).
 * Sin credenciales => pendiente de configuración; nunca afirma envíos.
 */
export async function GET() {
  return handle(async () => {
    const summary = await whatsappStatusSummary();
    return ok(summary);
  });
}
