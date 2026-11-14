"use client";
// Acceso al panel: una sola clave (la del propietario o el código único de un barbero).
// Sin credenciales de muestra visibles.
import { useState } from "react";
import { loginWithCode, type SessionUser } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo, PoleStripe } from "@/components/melo/ui";
import { ArrowLeft, KeyRound, Scissors, UserPlus } from "lucide-react";

export type { SessionUser };

export function LoginView({
  onBack,
  onLogged,
  onRegister,
}: {
  onBack: () => void;
  onLogged: (user: SessionUser) => void;
  onRegister?: () => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = loginWithCode(code);
      if (!user) {
        setError("Clave incorrecta. Verifícala e inténtalo de nuevo.");
        return;
      }
      onLogged(user);
    } catch {
      setError("No se pudo iniciar sesión");
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
            <KeyRound className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-[0.2em]">Acceso interno</span>
          </div>
          <h1 className="font-display text-3xl font-bold">Ingresa tu clave</h1>
          <p className="mt-1 text-sm text-ink-soft">La clave del propietario abre el panel completo; el código de cada barbero abre su propio panel.</p>

          <form onSubmit={submit} className="mt-6 grid gap-4">
            <div className="grid gap-2">
              <Input
                id="login-code"
                type="password"
                autoComplete="current-password"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="••••••••"
                autoFocus
                className="text-center text-lg tracking-[0.3em]"
                required
              />
            </div>
            {error ? <div className="rounded-lg border border-melo/40 bg-melo/10 px-4 py-3 text-sm text-melo-dark">{error}</div> : null}
            <Button type="submit" disabled={busy || !code.trim()} className="bg-ink text-ivory hover:bg-ink/80">
              {busy ? "Verificando…" : "Ingresar"} <Scissors className="ml-2 h-4 w-4" />
            </Button>
          </form>

          {onRegister ? (
            <div className="mt-5 border-t border-ink/10 pt-4 text-center">
              <p className="text-xs text-ink-soft">¿Te invitó el dueño y aún no tienes cuenta?</p>
              <Button variant="outline" onClick={onRegister} className="mt-2 w-full border-brass/50 text-brass-dark hover:bg-brass/10">
                <UserPlus className="mr-2 h-4 w-4" /> Registrarme con mi invitación
              </Button>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
