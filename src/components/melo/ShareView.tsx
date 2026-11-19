"use client";
// ============================================================ COMPARTIR (solo dueño)
// Generador de QR para llevar clientes a la agenda: el QR general de reservas
// y el QR de reseñas de cada barbero. Todos con el perrito de la marca al
// centro, descargables o mostrables a pantalla completa desde el celular.

import { QrShareCard } from "@/components/melo/QrShareCard";
import { bookingLink, reviewLink } from "@/lib/qrcode";
import { getDB } from "@/lib/store";
import { Star, Users } from "lucide-react";

export function ShareView() {
  const db = getDB();
  const barbers = db.barbers.filter((b) => b.active);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-bold">Compartir y traer clientes</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Muestra el QR en el mostrador, pégalo en el espejo o mándalo por WhatsApp. Cada código lleva al cliente directo a donde quieres: a reservar o a calificar a un barbero.
        </p>
      </div>

      {/* QR general de reservas */}
      <div className="grid gap-4 md:grid-cols-2">
        <QrShareCard
          title="Reservas de la barbería"
          subtitle="Al escanearlo, el cliente ve la agenda para reservar su cita al instante."
          url={bookingLink()}
          filename="melo-qr-reservas"
        />

        <div className="flex flex-col justify-center rounded-3xl border border-ink/10 bg-ivory p-5 text-sm text-ink-soft shadow-sm">
          <div className="font-display text-base font-bold text-ink">¿Cómo usarlo?</div>
          <ul className="mt-2 list-disc space-y-1.5 pl-4">
            <li><b className="text-ink">Mostrador:</b> descarga el QR e imprímelo; el cliente escanea y reserva sin ayuda.</li>
            <li><b className="text-ink">WhatsApp:</b> copia el link y mándalo a tus clientes de una.</li>
            <li><b className="text-ink">Instagram:</b> pon el link de reservas en la bio de la barbería.</li>
          </ul>
          <div className="mt-3 rounded-2xl bg-brass/10 px-4 py-3 text-xs text-brass-dark">
            Todos los QR llevan la carita del perrito de la marca en el centro y funcionan con cualquier cámara de celular.
          </div>
        </div>
      </div>

      {/* QR de reseñas por barbero */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <Users className="h-5 w-5 text-brass-dark" />
          <h3 className="font-display text-lg font-bold">Reseñas por barbero</h3>
        </div>
        <p className="mb-4 text-sm text-ink-soft">
          Cada barbero tiene su propio QR y link de reseñas: lo muestra al final del corte o lo envía por WhatsApp, y el cliente lo califica al toque, sin entrar a reservas.
        </p>
        {barbers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-ink/15 px-6 py-8 text-center text-ink-soft">
            Aún no hay barberos activos. Crea uno en «Equipo» y aquí aparecerá su QR de reseñas.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {barbers.map((b) => {
              const reviews = db.comments.filter((c) => c.barberId === b.id && c.postId === null && !c.hidden && c.rating);
              const avg = reviews.length ? reviews.reduce((s, c) => s + (c.rating ?? 0), 0) / reviews.length : 0;
              return (
                <div key={b.id} className="space-y-2">
                  <QrShareCard
                    title={`Reseñas de ${b.name}`}
                    subtitle={`Link y QR solo para calificar a ${b.name}`}
                    url={reviewLink(b.reviewCode)}
                    filename={`melo-qr-reseñas-${b.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                  />
                  <div className="flex items-center gap-1.5 rounded-xl border border-ink/10 bg-ivory px-3 py-2 text-xs text-ink-soft">
                    <Star className="h-3.5 w-3.5 fill-brass text-brass" />
                    {reviews.length > 0 ? `${Math.round(avg * 10) / 10} / 5 · ${reviews.length} reseña${reviews.length === 1 ? "" : "s"}` : "Sin reseñas todavía"}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
