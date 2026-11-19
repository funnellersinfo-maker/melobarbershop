"use client";
// MELO BARBERSHOP — página única (única ruta visible: /).
// Sin sesión: sitio público con reservas. Con sesión: panel por rol.
// Persistencia 100% local (localStorage) — sin backend.
import { useEffect, useState } from "react";
import { getSession, logout, type SessionUser } from "@/lib/store";
import { setupNotificationPersistence, ensureServiceWorker } from "@/lib/notify-client";
import { startSync } from "@/lib/sync";
import { PublicView } from "@/components/melo/PublicView";
import { LoginView } from "@/components/melo/LoginView";
import { AppShell, type ViewId } from "@/components/melo/AppShell";
import { AgendaView } from "@/components/melo/AgendaView";
import { OwnerDashboard, BarberDashboard } from "@/components/melo/Dashboards";
import { PaymentsView, MyPaymentsView } from "@/components/melo/PaymentsView";
import { CommissionsView } from "@/components/melo/CommissionsView";
import { SettlementsView } from "@/components/melo/SettlementsView";
import { AdjustmentsView, ExpensesView } from "@/components/melo/AdjustmentsExpenses";
import { CatalogView, WorkersView, MyAvailabilityView, AuditView } from "@/components/melo/TeamCatalog";
import { ReportsView } from "@/components/melo/ReportsView";
import { NotificationsView, SocialModerationView, MyProfileView } from "@/components/melo/NotifSettings";
import { SettingsView } from "@/components/melo/SettingsView";
import { LoadingBlock } from "@/components/melo/ui";

export default function Page() {
  const [checking, setChecking] = useState(true);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [mode, setMode] = useState<"public" | "login">("public");
  const [view, setView] = useState<string>("dashboard");

  useEffect(() => {
    // cargar store (seed) antes de renderizar para evitar parpadeos
    const s = getSession();
    setUser(s);
    if (s && s.role === "BARBER") setView("dashboard");
    setChecking(false);

    // sincronización multi-dispositivo: computador, celular y visitantes ven
    // siempre el mismo estado (bajar cambios cada 4s + subir al guardar)
    void startSync();

    // notificaciones push persistentes + service worker
    void ensureServiceWorker();
    setupNotificationPersistence();

    const h = () => {
      const s2 = getSession();
      setUser(s2);
    };
    window.addEventListener("melo:session", h);
    return () => window.removeEventListener("melo:session", h);
  }, []);

  function doLogout() {
    logout();
    setUser(null);
    setMode("public");
    setView("dashboard");
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream p-6">
        <LoadingBlock label="Cargando MELO BARBERSHOP…" />
      </div>
    );
  }

  if (!user) {
    if (mode === "login") {
      return <LoginView onBack={() => setMode("public")} onLogged={(u) => { setUser(u); setView("dashboard"); }} />;
    }
    return <PublicView onLogin={() => setMode("login")} />;
  }

  return (
    <AppShell user={user} view={view} setView={setView as (v: ViewId) => void} onLogout={doLogout}>
      {(() => {
        switch (view) {
          // compartidos
          case "agenda":
            return <AgendaView user={user} />;
          case "settlements":
            return <SettlementsView user={user} />;
          case "notifications":
            return <NotificationsView user={user} />;
          // propietario
          case "dashboard":
            return user.role === "OWNER" ? <OwnerDashboard go={(v) => setView(v)} /> : <BarberDashboard user={user} />;
          case "payments":
            return user.role === "OWNER" ? <PaymentsView user={user} /> : <MyPaymentsView user={user} />;
          case "commissions":
          case "myCommissions":
            return <CommissionsView user={user} />;
          case "adjustments":
            return <AdjustmentsView />;
          case "expenses":
            return <ExpensesView />;
          case "catalog":
            return <CatalogView />;
          case "workers":
            return <WorkersView user={user} />;
          case "social":
            return <SocialModerationView />;
          case "reports":
            return <ReportsView />;
          case "audit":
            return <AuditView />;
          case "settings":
            return <SettingsView />;
          // barbero
          case "myProfile":
            return <MyProfileView user={user} />;
          case "myAvailability":
            return <MyAvailabilityView user={user} />;
          default:
            return user.role === "OWNER" ? <OwnerDashboard go={(v) => setView(v)} /> : <BarberDashboard user={user} />;
        }
      })()}
    </AppShell>
  );
}
