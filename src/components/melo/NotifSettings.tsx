"use client";
// Notificaciones (ambos roles) y Configuración (WhatsApp del propietario).
import { useState } from "react";
import { api, useData } from "@/lib/api";
import { fmtDateMedium, timeHMInBogota } from "@/lib/time";
import { SectionTitle, LoadingBlock, ErrorBlock, EmptyState, Chip } from "@/components/melo/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { Bell, CheckCheck, MessageSquare, Send, RotateCcw, ShieldAlert, CheckCircle2, Clock, Ban } from "lucide-react";
import { cn } from "@/lib/utils";

export function NotificationsView() {
  const q = useData<{ notifications: Array<{ id: string; type: string; title: string; message: string; read: boolean; createdAt: string }>; unread: number }>("/api/notifications");

  return (
    <div>
      <SectionTitle
        title="Notificaciones"
        sub="Internas y siempre operativas: nuevas reservas, cambios, cancelaciones, próximas citas y eventos financieros autorizados. WhatsApp es un complemento, no un requisito."
        right={
          <Button
            variant="outline"
            className="border-brass/50 text-brass-dark hover:bg-brass/10"
            onClick={async () => {
              await api("/api/notifications", { method: "POST" });
              q.reload();
            }}
          >
            <CheckCheck className="mr-1 h-4 w-4" /> Marcar todas leídas
          </Button>
        }
      />
      {q.loading ? <LoadingBlock /> : null}
      {q.error ? <ErrorBlock message={q.error} onRetry={q.reload} /> : null}
      {q.data && q.data.notifications.length === 0 ? (
        <EmptyState icon={<Bell className="h-8 w-8" />} title="Sin notificaciones" sub="Cuando haya eventos aparecerán aquí." />
      ) : null}
      {q.data && q.data.notifications.length > 0 ? (
        <div className="flex max-h-125 flex-col gap-2 overflow-y-auto pr-1 nice-scroll">
          {q.data.notifications.map((n) => (
            <div key={n.id} className={cn("rounded-xl border p-4", n.read ? "border-ink/10 bg-ivory opacity-75" : "border-brass/40 bg-brass/5")}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("text-sm font-semibold", n.read ? "text-ink/70" : "text-ink")}>{n.title}</span>
                {!n.read ? <Chip className="border-melo/40 text-melo-dark">nueva</Chip> : null}
                <Chip className="ml-auto">{n.type}</Chip>
                <span className="text-[11px] text-ink/40">{fmtDateMedium(new Date(n.createdAt))} {timeHMInBogota(new Date(n.createdAt))}</span>
              </div>
              <div className="mt-1 text-sm text-ink-soft">{n.message}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

type WaRecord = {
  id: string;
  toPhone: string;
  messageType: string;
  body: string;
  status: string;
  providerMessageId: string | null;
  error: string | null;
  attempts: number;
  createdAt: string;
  appointmentCode: string | null;
};

export function SettingsView() {
  const q = useData<{ config: { configured: boolean; provider: string; apiUrl: string; apiVersion: string; phoneNumberIdMasked: string | null; messageMode: string }; counts: Record<string, number>; recent: WaRecord[] }>(
    "/api/whatsapp/status"
  );
  const [testTo, setTestTo] = useState("+573001234567");
  const [busy, setBusy] = useState(false);

  const cfg = q.data?.config;
  const counts = q.data?.counts ?? {};

  async function sendTest() {
    setBusy(true);
    try {
      const res = await api<{ status: string }>("/api/whatsapp/test", { method: "POST", body: JSON.stringify({ to: testTo }) });
      toast({
        title: res.status === "SENT" ? "Mensaje de prueba enviado" : `Estado: ${res.status}`,
        description: res.status === "SENT" ? "El proveedor respondió con un id de mensaje." : "Revisa el registro para más detalle.",
      });
      q.reload();
    } catch (e) {
      toast({ title: "No se pudo enviar", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    setBusy(true);
    try {
      const res = await api<{ requeued: number }>("/api/whatsapp/retry", { method: "POST" });
      toast({ title: `Reintentos encolados: ${res.requeued}` });
      q.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <SectionTitle title="Configuración" sub="Integración de WhatsApp y estado del sistema. Las credenciales viven solo en variables de entorno del servidor; nunca se exponen en el navegador." />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={cn("rounded-2xl border p-5", cfg?.configured ? "border-good/40 bg-good/5" : "border-ink/15 bg-ivory")}>
          <div className="mb-2 flex items-center gap-2 font-display text-lg font-bold">
            <MessageSquare className="h-5 w-5" /> WhatsApp Business
          </div>
          {!q.loading && cfg ? (
            <>
              <div className="mb-3 flex items-center gap-2 text-sm">
                {cfg.configured ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-good/15 px-3 py-1 font-medium text-good"><CheckCircle2 className="h-4 w-4" /> Configurado</span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-warn/15 px-3 py-1 font-medium text-warn"><Clock className="h-4 w-4" /> Pendiente de configuración</span>
                )}
              </div>
              <div className="grid gap-1 text-sm text-ink-soft">
                <div>Proveedor: <b className="text-ink">{cfg.provider}</b></div>
                <div>API: <span className="tabular-nums">{cfg.apiUrl}/{cfg.apiVersion}</span></div>
                <div>Número (id): <span className="tabular-nums">{cfg.phoneNumberIdMasked ?? "—"}</span></div>
                <div>Modo de mensaje: {cfg.messageMode === "template" ? "plantillas aprobadas" : "texto (sesión 24 h)"}</div>
              </div>

              {!cfg.configured ? (
                <div className="mt-4 rounded-xl bg-cream p-4 text-sm">
                  <div className="mb-1 flex items-center gap-2 font-semibold text-warn"><ShieldAlert className="h-4 w-4" /> Sin credenciales</div>
                  <p className="text-ink-soft">
                    La agenda y las notificaciones internas siguen funcionando con normalidad. Define en el archivo <code className="rounded bg-ink/10 px-1">.env</code>:
                  </p>
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-ink p-3 text-xs text-cream">{`WHATSAPP_TOKEN=EAAG...
WHATSAPP_PHONE_NUMBER_ID=123456789
# opcional, proveedor compatible:
# WHATSAPP_API_URL=https://graph.facebook.com
# WHATSAPP_MESSAGE_MODE=template`}</pre>
                  <p className="mt-2 text-xs text-ink-soft">Nunca se afirma un envío que no ocurrió: los mensajes quedan “pendiente de configuración”.</p>
                </div>
              ) : (
                <div className="mt-4 grid gap-2">
                  <div className="grid gap-1">
                    <Label className="text-xs">Mensaje de prueba</Label>
                    <div className="flex gap-2">
                      <Input value={testTo} onChange={(e) => setTestTo(e.target.value)} className="w-44" />
                      <Button disabled={busy} onClick={sendTest} className="bg-good hover:bg-good/85 text-ivory"><Send className="mr-1 h-4 w-4" /> Probar</Button>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <Chip className="border-good/40 text-good">Enviados: {counts.SENT ?? 0}</Chip>
                <Chip className="border-warn/40 text-warn">En cola: {counts.QUEUED ?? 0}</Chip>
                <Chip className="border-melo/40 text-melo-dark">Fallidos: {counts.FAILED ?? 0}</Chip>
                <Chip>Pend. config: {counts.PENDING_CONFIG ?? 0}</Chip>
                <Chip>Sin teléfono: {counts.SKIPPED ?? 0}</Chip>
              </div>
              <Button variant="outline" onClick={retry} disabled={busy} className="mt-3 border-ink/20">
                <RotateCcw className="mr-1 h-4 w-4" /> Reintentar fallidos (máx. 3 intentos por mensaje)
              </Button>
            </>
          ) : (
            <LoadingBlock label="Consultando integración…" />
          )}
        </div>

        <div className="rounded-2xl border border-ink/10 bg-ivory p-5">
          <div className="mb-2 font-display text-lg font-bold">Registro de mensajes</div>
          <p className="mb-3 text-xs text-ink-soft">Cada envío conserva su identificador de evento (deduplicación), intentos y, si hubo respuesta, el id del proveedor.</p>
          {!q.data || q.data.recent.length === 0 ? (
            <EmptyState title="Sin mensajes registrados" sub="Aparecen al reservar con teléfono o al programar recordatorios." />
          ) : (
            <div className="max-h-90 overflow-y-auto pr-1 nice-scroll">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Destino</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Id / error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {q.data.recent.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="whitespace-nowrap text-xs">{fmtDateMedium(new Date(m.createdAt))} {timeHMInBogota(new Date(m.createdAt))}</TableCell>
                      <TableCell className="text-xs tabular-nums">{m.toPhone || "—"}</TableCell>
                      <TableCell className="text-xs">{m.messageType}</TableCell>
                      <TableCell>
                        <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                          m.status === "SENT" ? "bg-good/15 text-good border-good/40"
                            : m.status === "FAILED" ? "bg-melo/15 text-melo-dark border-melo/40"
                            : m.status === "PENDING_CONFIG" ? "bg-warn/15 text-warn border-warn/40" : "bg-ink/10 text-ink-soft border-ink/30")}>
                          {m.status === "SENT" ? <CheckCircle2 className="h-3 w-3" /> : m.status === "FAILED" ? <Ban className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                          {m.status}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-52 truncate text-[11px] text-ink-soft">
                        {m.providerMessageId ?? m.error?.slice(0, 80) ?? "—"}{m.attempts > 1 ? ` (${m.attempts} intentos)` : ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
