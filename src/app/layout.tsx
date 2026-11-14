import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  metadataBase: new URL("https://melobarbershop.pages.dev"),
  title: "MELO BARBERSHOP · Reserva tu cita online en Bogotá",
  description:
    "Reserva tu cita en MELO BARBERSHOP: corte clásico, barba, diseño y lavado. Elige tu barbero, día y hora en línea y recibe la confirmación por WhatsApp.",
  keywords: ["barbería Bogotá", "MELO Barbershop", "reservar cita barbería", "corte de pelo Bogotá", "barba", "barbería cerca de mí"],
  authors: [{ name: "MELO BARBERSHOP" }],
  icons: {
    icon: "/melo-logo.png",
    apple: "/melo-logo.png",
  },
  manifest: "/manifest.json",
  openGraph: {
    title: "MELO BARBERSHOP · Más que un corte, una experiencia",
    description: "Reserva en línea con el barbero de tu preferencia. Sin filas, sin llamadas: elige servicio, hora y confirma por WhatsApp.",
    siteName: "MELO BARBERSHOP",
    type: "website",
    locale: "es_CO",
    images: [{ url: "/melo-logo.png", width: 512, height: 512, alt: "MELO BARBERSHOP" }],
  },
  twitter: {
    card: "summary",
    title: "MELO BARBERSHOP · Reserva tu cita online",
    description: "Corte, barba y diseño con los mejores barberos. Reserva en línea y confirma por WhatsApp.",
    images: ["/melo-logo.png"],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#a63d40",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
