import { NextRequest, NextResponse } from "next/server";

/**
 * Proveedor de demostración compatible con WhatsApp Cloud API (solo desarrollo).
 * Se activa configurando en .env:
 *   WHATSAPP_API_URL=http://localhost:3000/api/whatsapp/mock
 *   WHATSAPP_TOKEN=cualquier-valor
 *   WHATSAPP_PHONE_NUMBER_ID=123456789
 * Comportamiento según los DÍGITOS del destino (sobrevive a la normalización):
 *  - contiene "999": responde error 500 (fallo controlado, agota los 3 reintentos).
 *  - contiene "888": falla los 2 primeros intentos y sale en el 3.º (reintentos OK).
 *  - cualquier otro: acepta y devuelve un id de mensaje wamid.
 * En producción se apunta WHATSAPP_API_URL a https://graph.facebook.com con
 * credenciales reales de WhatsApp Business (ver README).
 */
const attemptsByPhone = new Map<string, number>();

export async function POST(req: NextRequest, _ctx: { params: Promise<{ path: string[] }> }) {
  const body = (await req.json().catch(() => null)) as { to?: string; text?: { body?: string } } | null;
  const to = String(body?.to ?? "");
  const digits = to.replace(/\D/g, "");

  if (digits.includes("999")) {
    return NextResponse.json(
      { error: { message: "(mock) fallo simulado del proveedor", type: "MOCK_PROVIDER_ERROR" } },
      { status: 500 }
    );
  }
  if (digits.includes("888")) {
    const n = (attemptsByPhone.get(to) ?? 0) + 1;
    attemptsByPhone.set(to, n);
    if (n < 3) {
      return NextResponse.json(
        { error: { message: `(mock) fallo transitorio ${n}/3`, type: "MOCK_TRANSIENT" } },
        { status: 500 }
      );
    }
  }

  const id = `wamid.MOCK${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  return NextResponse.json({
    messaging_product: "whatsapp",
    contacts: [{ input: to, wa_id: digits }],
    messages: [{ id }],
  });
}
