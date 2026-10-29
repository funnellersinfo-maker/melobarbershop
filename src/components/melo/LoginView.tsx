"use client";
// Inicio de sesión para propietario y barberos.
import { useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo, PoleStripe } from "@/components/melo/ui";
import { Scissors, Lock, ArrowLeft } from "lucide-react";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: "OWNER" | "BARBER";
  active: boolean;
  permissions: Record<string, boolean>;
  notifyInternal: boolean;
  notifyWhatsapp: boolean;
};

export function LoginView({ onBack, onLogged }: { onBack: () => void; onLogged: (user: SessionUser) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ user: SessionUser }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      onLogged(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar sesión");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-cream text-ink">
      <header className="border-b border-ink/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
            <ArrowLeft className="h-4 w-4" /> Volver a la página pública
          </button>
          <div className="flex items-center gap-2">
            <Logo size={30} />
            <span className="font-display text-lg font-bold tracking-widest">MELO</span>
          </div>
        </div>
        <PoleStripe className="rounded-none" />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md rounded-3xl border border-ink/10 bg-ivory p-8 shadow-md">
          <div className="mb-2 flex items-center gap-2 text-brass-dark">
            <Lock className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-[0.2em]">Panel interno</span>
          </div>
          <h1 className="font-display text-3xl font-bold">Bienvenido</h1>
          <p className="mt-1 text-sm text-ink-soft">Ingresa con tu cuenta de barbero o propietario.</p>

          <form onSubmit={submit} className="mt-6 grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="login-email">Correo</Label>
              <Input
                id="login-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tucorreo@melo.com"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="login-pass">Contraseña</Label>
              <Input
                id="login-pass"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
            {error ? <div className="rounded-lg border border-melo/40 bg-melo/10 px-4 py-3 text-sm text-melo-dark">{error}</div> : null}
            <Button type="submit" disabled={busy} className="bg-ink text-ivory hover:bg-ink/80">
              {busy ? "Verificando…" : "Ingresar"} <Scissors className="ml-2 h-4 w-4" />
            </Button>
          </form>

          <div className="mt-6 rounded-xl border border-dashed border-brass/50 bg-cream p-4 text-xs text-ink-soft">
            <div className="mb-1 font-semibold text-ink">Cuentas de demostración (cámbialas en Configuración):</div>
            <div>Propietario: <b>owner@melo.com</b> · <b>melo1234</b></div>
            <div>Barberos: <b>santiago / andres / camilo</b>@melo.com · <b>melo1234</b></div>
          </div>
        </div>
      </main>
    </div>
  );
}
