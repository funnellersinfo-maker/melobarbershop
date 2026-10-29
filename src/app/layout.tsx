import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MELO BARBERSHOP · Reservas y gestión",
  description:
    "Más que un corte, una experiencia. Reserva tu cita en línea y gestiona la barbería: agenda, pagos, comisiones y reportes. MELO BARBERSHOP.",
  keywords: ["barbería", "MELO Barbershop", "reservas", "citas", "barbería Bogotá", "gestión de barbería"],
  authors: [{ name: "MELO BARBERSHOP" }],
  icons: {
    icon: "/melo-logo.png",
  },
  openGraph: {
    title: "MELO BARBERSHOP",
    description: "Más que un corte, una experiencia… Reserva tu cita en línea.",
    siteName: "MELO BARBERSHOP",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
