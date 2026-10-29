"use client";
// MELO BARBERSHOP — página única (única ruta visible: /).
// Sin sesión: página pública con reservas o login. Con sesión: panel por rol.
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PublicView } from "@/components/melo/PublicView";
import { LoginView, type SessionUser } from "@/components/melo/LoginView";
import { AppShell, type ViewId } from "@/components/melo/AppShell";
import { AgendaView } from "@/components/melo/AgendaView";
import { OwnerDashboard, BarberDashboard } from "@/components/melo/Dashboards";
import { PaymentsView, MyPaymentsView } from "@/components/melo/PaymentsView";
import { CommissionsView, MyCommissionsView } from "@/components/melo/CommissionsView";
import { SettlementsView } from "@/components/melo/SettlementsView";
import { AdjustmentsView, ExpensesView } from "@/components/melo/AdjustmentsExpenses";
import { CatalogView, WorkersView, MyAvailabilityView, MyServicesView, AuditView } from "@/components/melo/TeamCatalog";
import { ReportsView } from "@/components/melo/ReportsView";
import { NotificationsView, SettingsView } from "@/components/melo/NotifSettings";
import { LoadingBlock } from "@/components/melo/ui";

export default function Page() {
  const [checking, setChecking] = useState(true);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [mode, setMode] = useState<"public" | "login">("public");
  const [view, setView] = useState<ViewId>("dashboard");
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await api<{ user: SessionUser | null }>("/api/auth/me");
        setUser(res.user);
        if (res.user && res.user.role === "BARBER") setView("dashboard");
      } catch {
        setUser(null);
      } finally {
        setChecking(false);
        setTimeout(() => setBooted(true), 50);
      }
    })();
  }, []);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setUser(null);
    setMode("public");
    setView("dashboard");
  }

  if (checking && !booted) {
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
    <AppShell user={user} view={view} setView={setView} onLogout={logout}>
      {(() => {
        switch (view) {
          // compartidos
          case "agenda":
            return <AgendaView user={user} />;
          case "settlements":
            return <SettlementsView user={user} />;
          case "notifications":
            return <NotificationsView />;
          // propietario
          case "dashboard":
            return user.role === "OWNER" ? <OwnerDashboard go={(v) => setView(v as ViewId)} /> : <BarberDashboard />;
          case "payments":
            return user.role === "OWNER" ? <PaymentsView user={user} /> : <MyPaymentsView />;
          case "commissions":
            return <CommissionsView user={user} />;
          case "adjustments":
            return <AdjustmentsView />;
          case "expenses":
            return <ExpensesView />;
          case "catalog":
            return <CatalogView />;
          case "workers":
            return <WorkersView user={user} />;
          case "reports":
            return <ReportsView />;
          case "audit":
            return <AuditView />;
          case "settings":
            return <SettingsView />;
          // barbero
          case "myCommissions":
            return <MyCommissionsView user={user} />;
          case "myAvailability":
            return <MyAvailabilityView user={user} />;
          case "myServices":
            return <MyServicesView user={user} />;
          default:
            return <OwnerDashboard go={(v) => setView(v as ViewId)} />;
        }
      })()}
    </AppShell>
  );
}
