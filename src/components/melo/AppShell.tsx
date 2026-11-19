"use client";
// Shell del panel por rol (propietario / barbero) con campana y permisos.
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { getDB, getSession, setSession, getAdminData, isOwnerPremium, ownerAutoXP, type SessionUser } from "@/lib/store";
import { BrandLockup, PoleStripe, Logo } from "@/components/melo/ui";
import { AiAssistant } from "@/components/melo/AiAssistant";
import { LEVELS, barberLevel } from "@/components/melo/Dashboards";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  LayoutDashboard, CalendarDays, Wallet, Percent, HandCoins, SlidersHorizontal, Receipt, Scissors, Users, BarChart3,
  Bell, History, Settings, LogOut, CheckCheck, Clock, ChevronDown, MessageSquareShare, QrCode,
} from "lucide-react";
import { fmtDateMedium, timeHMInBogota } from "@/lib/time";

export type ViewId =
  | "dashboard" | "agenda" | "payments" | "commissions" | "settlements" | "adjustments"
  | "expenses" | "catalog" | "workers" | "reports" | "notifications" | "audit" | "settings"
  | "social" | "share" | "myProfile" | "myAvailability";

export function AppShell({
  user,
  view,
  setView,
  onLogout,
  children,
}: {
  user: SessionUser;
  view: string;
  setView: (v: ViewId) => void;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const [tick, setTick] = useState(0);
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    const h = () => force((n) => n + 1);
    window.addEventListener("melo:db-changed", h);
    return () => { clearInterval(t); window.removeEventListener("melo:db-changed", h); };
  }, []);

  const db = getDB();
  const isOwner = user.role === "OWNER";
  const myId = isOwner ? "OWNER" : user.id;
  const myNotifs = db.notifications.filter((n) => n.userId === myId);
  const unread = myNotifs.filter((n) => !n.read).length;

  const barberPerms = !isOwner ? (db.barbers.find((b) => b.id === user.id)?.permissions ?? {}) : {};
  const perm = (k: string) => isOwner || !!barberPerms[k];

  const items: Array<{ id: ViewId; label: string; icon: React.ReactNode; show: boolean }> = isOwner
    ? [
        { id: "dashboard", label: "Panel", icon: <LayoutDashboard className="h-4 w-4" />, show: true },
        { id: "agenda", label: "Agenda", icon: <CalendarDays className="h-4 w-4" />, show: true },
        { id: "payments", label: "Pagos y caja", icon: <Wallet className="h-4 w-4" />, show: true },
        { id: "commissions", label: "Comisiones", icon: <Percent className="h-4 w-4" />, show: true },
        { id: "settlements", label: "Liquidaciones", icon: <HandCoins className="h-4 w-4" />, show: true },
        { id: "adjustments", label: "Ajustes", icon: <SlidersHorizontal className="h-4 w-4" />, show: true },
        { id: "expenses", label: "Gastos", icon: <Receipt className="h-4 w-4" />, show: true },
        { id: "catalog", label: "Catálogo", icon: <Scissors className="h-4 w-4" />, show: true },
        { id: "workers", label: "Equipo", icon: <Users className="h-4 w-4" />, show: true },
        { id: "share", label: "Compartir", icon: <QrCode className="h-4 w-4" />, show: true },
        { id: "social", label: "Comunidad", icon: <MessageSquareShare className="h-4 w-4" />, show: true },
        { id: "reports", label: "Reportes", icon: <BarChart3 className="h-4 w-4" />, show: true },
        { id: "notifications", label: "Notificaciones", icon: <Bell className="h-4 w-4" />, show: true },
        { id: "audit", label: "Historial", icon: <History className="h-4 w-4" />, show: true },
        { id: "settings", label: "Configuración", icon: <Settings className="h-4 w-4" />, show: true },
      ]
    : [
        { id: "dashboard", label: "Mi día", icon: <LayoutDashboard className="h-4 w-4" />, show: true },
        { id: "agenda", label: "Mi agenda", icon: <CalendarDays className="h-4 w-4" />, show: true },
        { id: "payments", label: "Mis cobros", icon: <Wallet className="h-4 w-4" />, show: perm("payments.register") },
        { id: "myCommissions" as ViewId, label: "Mis comisiones", icon: <Percent className="h-4 w-4" />, show: perm("commissions.view") },
        { id: "settlements", label: "Mis liquidaciones", icon: <HandCoins className="h-4 w-4" />, show: perm("settlements.view") },
        { id: "myProfile", label: "Mi perfil", icon: <Users className="h-4 w-4" />, show: perm("profile.edit") },
        { id: "myAvailability", label: "Mi disponibilidad", icon: <Clock className="h-4 w-4" />, show: perm("schedule.manageOwn") },
        { id: "notifications", label: "Notificaciones", icon: <Bell className="h-4 w-4" />, show: true },
      ];
  const visible = items.filter((i) => i.show);
  const current = visible.find((i) => i.id === view) ?? visible[0];

  function markAllRead() {
    const { mutateDB } = require("@/lib/store") as typeof import("@/lib/store");
    mutateDB((d) => {
      for (const n of d.notifications) if (n.userId === myId) n.read = true;
    });
    force((n) => n + 1);
  }

  return (
    <div className="flex min-h-screen flex-col bg-cream text-ink">
      <header className="sticky top-0 z-40 border-b border-ink/10 bg-cream/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <BrandLockup compact />
          <div className="flex items-center gap-2">
            <span className="hidden rounded-full border border-ink/10 bg-ivory px-3 py-1 text-xs text-ink-soft md:inline">
              {current?.icon} {current?.label}
            </span>

            {/* campana */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="icon" className="relative border-ink/15 bg-ivory" aria-label="Notificaciones">
                  <Bell className="h-4 w-4" />
                  {unread > 0 ? (
                    <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-melo px-1 text-[10px] font-bold text-ivory">
                      {unread > 99 ? "99+" : unread}
                    </span>
                  ) : null}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[calc(100vw-1.5rem)] max-w-96 p-0">
                <div className="flex items-center justify-between border-b border-ink/10 px-4 py-3">
                  <span className="font-display font-bold">Notificaciones</span>
                  <button onClick={markAllRead} className="inline-flex items-center gap-1 text-xs font-medium text-brass-dark hover:underline">
                    <CheckCheck className="h-3.5 w-3.5" /> Marcar leídas
                  </button>
                </div>
                <div className="max-h-96 overflow-y-auto nice-scroll">
                  {myNotifs.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-ink-soft">Sin notificaciones por ahora.</div>
                  ) : (
                    myNotifs.slice(0, 30).map((n) => (
                      <div key={n.id} className={cn("border-b border-ink/5 px-4 py-3", !n.read && "bg-brass/5")}>
                        <div className="flex items-start justify-between gap-2">
                          <span className={cn("text-sm font-semibold", n.read ? "text-ink/70" : "text-ink")}>{n.title}</span>
                          <span className="whitespace-nowrap text-[10px] text-ink/40">
                            {fmtDateMedium(new Date(n.createdAt))} {timeHMInBogota(new Date(n.createdAt))}
                          </span>
                        </div>
                        <div className="mt-0.5 text-xs text-ink-soft">{n.message}</div>
                      </div>
                    ))
                  )}
                </div>
                <button
                  onClick={() => setView("notifications")}
                  className="block w-full border-t border-ink/10 px-4 py-2 text-center text-xs font-medium text-brass-dark hover:bg-brass/5"
                >
                  Ver todas
                </button>
              </PopoverContent>
            </Popover>

            {/* menú usuario */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="border-ink/15 bg-ivory pl-2">
                  {(() => {
                    const b = !isOwner ? db.barbers.find((x) => x.id === user.id) : null;
                    return b?.photo ? (
                      <img src={b.photo} alt={b.name} className="h-6 w-6 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brass/20 text-[10px] font-bold text-brass-dark">
                        {user.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                      </span>
                    );
                  })()}
                  <span className="hidden max-w-28 truncate sm:inline">{user.name.split(" ")[0]}</span>
                  <ChevronDown className="h-4 w-4 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>
                  <div className="text-sm font-semibold">{isOwner ? getAdminData().profile.name : user.name}</div>
                  <div className="text-xs text-ink-soft">
                    {isOwner
                      ? `Propietario${(() => {
                          const p = getAdminData().profile;
                          if (!isOwnerPremium(p)) return "";
                          const xp = p.manualXP ? p.xpOverride : ownerAutoXP(db);
                          const l = p.levelOverride
                            ? (LEVELS.find((x) => x.name === p.levelOverride) ?? LEVELS[0])
                            : barberLevel(xp).current;
                          return ` · ${l.icon} ${l.name}`;
                        })()}`
                      : "Barbero"}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setView("notifications")}>
                  <Bell className="mr-2 h-4 w-4" /> Notificaciones
                </DropdownMenuItem>
                {isOwner ? (
                  <DropdownMenuItem onClick={() => setView("settings")}>
                    <Settings className="mr-2 h-4 w-4" /> Configuración
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onLogout} className="text-melo-dark focus:bg-melo/10 focus:text-melo-dark">
                  <LogOut className="mr-2 h-4 w-4" /> Cerrar sesión
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <PoleStripe className="rounded-none" />
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-6 overflow-x-clip px-4 py-6">
        <nav className="sticky top-24 hidden h-fit w-60 shrink-0 flex-col gap-1 rounded-2xl border border-ink/10 bg-ivory p-3 lg:flex">
          {visible.map((it) => (
            <button
              key={it.id}
              onClick={() => setView(it.id)}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                view === it.id ? "bg-ink text-ivory" : "text-ink-soft hover:bg-cream hover:text-ink"
              )}
            >
              {it.icon} {it.label}
              {it.id === "notifications" && unread > 0 ? (
                <span className="ml-auto rounded-full bg-melo px-1.5 text-[10px] font-bold text-ivory">{unread}</span>
              ) : null}
            </button>
          ))}
        </nav>

        <div className="min-w-0 max-w-full flex-1 overflow-x-clip">
          <div className="mb-4 flex w-full max-w-full gap-2 overflow-x-auto overscroll-x-contain pb-1 nice-scroll lg:hidden">
            {visible.map((it) => (
              <button
                key={it.id}
                onClick={() => setView(it.id)}
                className={cn(
                  "whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium transition",
                  view === it.id ? "border-ink bg-ink text-ivory" : "border-ink/15 bg-ivory text-ink-soft"
                )}
              >
                {it.icon} {it.label}
              </button>
            ))}
          </div>
          <div className="min-h-80">{children}</div>
        </div>
      </div>

      <footer className="mt-auto bg-ink py-3 text-center text-xs text-cream/60">
        MELO BARBERSHOP · Panel {isOwner ? "del propietario" : "de barbero"} · {new Date().toLocaleDateString("es-CO", { timeZone: "America/Bogota", weekday: "long", day: "numeric", month: "long", year: "numeric" })}
      </footer>

      {/* IA interna de administración: solo el dueño */}
      {isOwner ? <AiAssistant /> : null}
    </div>
  );
}
