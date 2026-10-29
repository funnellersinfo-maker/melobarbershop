// Punto de entrada de instrumentación de Next.js: arranca el programador
// (recordatorios y reintentos de WhatsApp) solo en runtime nodejs.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("@/lib/scheduler");
    startScheduler();
  }
}
