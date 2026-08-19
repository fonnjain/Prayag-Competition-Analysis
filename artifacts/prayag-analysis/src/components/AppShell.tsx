import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  BarChart3,
  ChevronLeft,
  Database,
  Hexagon,
  Home,
  LogOut,
  Menu,
  Search,
  Settings,
  X,
} from "lucide-react";
import { useAuth } from "@workspace/replit-auth-web";
import { cn } from "@/lib/utils";

// ── App-switcher entries (all cross-app = raw <a> links) ──────────────────────
type AppSwitcherEntry = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active?: boolean;
};

const APP_SWITCHER: AppSwitcherEntry[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/product-db/", label: "Product Database", icon: Database },
  { href: "/product-db/price-finder", label: "Price Finder", icon: Search },
  { href: "/analysis/", label: "Competition Analysis", icon: BarChart3, active: true },
];

// ── Analysis in-app nav ───────────────────────────────────────────────────────
const ANALYSIS_NAV = [
  { path: "/", label: "Dashboard", icon: BarChart3 },
  { path: "/settings/discounts", label: "Discount Settings", icon: Settings },
] as const;

// ── Breadcrumb label map keyed on wouter path ─────────────────────────────────
const BREADCRUMB_LABELS: Record<string, string> = {
  "/": "Dashboard",
  "/settings/discounts": "Discount Settings",
};

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const hadInAppNavigation = useRef(false);
  const initialLocation = useRef(location);

  const userName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    user?.email ||
    "User";

  const pageLabel = BREADCRUMB_LABELS[location] ?? "Competition Analysis";
  const isDashboard = location === "/";

  useEffect(() => {
    if (location !== initialLocation.current) hadInAppNavigation.current = true;
  }, [location]);

  const goBack = () => {
    if (hadInAppNavigation.current) {
      window.history.back();
      return;
    }
    window.location.href = "/analysis/";
  };

  // ── Sidebar content (shared between desktop + mobile drawer) ─────────────────
  function SidebarContent({ onNavClick }: { onNavClick?: () => void }) {
    return (
      <div className="flex flex-col h-full">
        {/* Brand */}
        <div className="flex items-center gap-2.5 px-4 h-14 border-b shrink-0">
          <div className="w-7 h-7 bg-primary rounded-lg flex items-center justify-center shadow-sm shrink-0">
            <Hexagon className="w-4 h-4 text-white" strokeWidth={2} />
          </div>
          <div className="leading-none min-w-0">
            <span className="font-bold text-sm text-foreground">Prayag</span>
            <span className="text-[10px] text-muted-foreground block">
              Pricing workspace
            </span>
          </div>
        </div>

        {/* Context label */}
        <div className="px-4 pt-4 pb-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1 mb-1">
            Competition Analysis
          </p>
        </div>

        {/* In-app nav */}
        <nav className="px-3 flex flex-col gap-0.5 flex-1" aria-label="Analysis navigation">
          {ANALYSIS_NAV.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.path;
            return (
              <a
                key={item.path}
                href={item.path === "/" ? "/analysis/" : `/analysis${item.path}`}
                aria-current={isActive ? "page" : undefined}
                onClick={onNavClick}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {item.label}
              </a>
            );
          })}
        </nav>

        {/* App switcher */}
        <div className="px-3 pb-3 pt-2 border-t mt-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1 mb-1.5">
            Switch app
          </p>
          {APP_SWITCHER.map((app) => {
            const Icon = app.icon;
            return (
              <a
                key={app.href}
                href={app.href}
                onClick={onNavClick}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary w-full",
                  app.active
                    ? "text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {app.label}
                {app.active && (
                  <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide bg-primary/10 text-primary rounded px-1.5 py-0.5">
                    Active
                  </span>
                )}
              </a>
            );
          })}
        </div>

        {/* User / logout */}
        <div className="px-3 pb-3 pt-2 border-t flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0 select-none">
            {userName.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground truncate">{userName}</p>
          </div>
          <button
            onClick={logout}
            title="Log out"
            aria-label="Log out"
            className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* ── Desktop sidebar ─────────────────────────────────────────────────── */}
      <aside className="hidden md:flex flex-col w-56 border-r bg-card shrink-0 overflow-y-auto">
        <SidebarContent />
      </aside>

      {/* ── Mobile drawer backdrop ───────────────────────────────────────────── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          aria-hidden="true"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── Mobile drawer ────────────────────────────────────────────────────── */}
      <aside
        id="mobile-nav-drawer"
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 bg-card border-r shadow-xl flex flex-col md:hidden transition-transform duration-200",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
        aria-label="Navigation drawer"
      >
        <div className="flex items-center justify-between px-4 h-14 border-b shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-primary rounded-md flex items-center justify-center">
              <Hexagon className="w-3.5 h-3.5 text-white" strokeWidth={2} />
            </div>
            <span className="font-bold text-sm">Prayag</span>
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation menu"
            className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <SidebarContent onNavClick={() => setMobileOpen(false)} />
        </div>
      </aside>

      {/* ── Main content area ────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="border-b bg-card flex items-center gap-3 px-4 h-14 shrink-0">
          {/* Mobile menu button */}
          <button
            className="md:hidden flex items-center justify-center rounded-md p-1.5 text-foreground hover:bg-accent transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav-drawer"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Breadcrumb / back bar */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <button
              type="button"
              onClick={goBack}
              aria-label="Go back"
              className={cn(
                "flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-md px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-primary",
                isDashboard && "opacity-40 pointer-events-none"
              )}
              tabIndex={isDashboard ? -1 : undefined}
            >
              <ChevronLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Back</span>
            </button>

            <div className="text-muted-foreground/50 select-none hidden sm:block">/</div>

            <nav aria-label="Breadcrumb" className="hidden sm:flex items-center gap-1 text-sm min-w-0">
              <a
                href="/analysis/"
                className="text-muted-foreground hover:text-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
              >
                Competition Analysis
              </a>
              {!isDashboard && (
                <>
                  <span className="text-muted-foreground/50 select-none">/</span>
                  <span className="text-foreground font-medium truncate">{pageLabel}</span>
                </>
              )}
            </nav>

            {/* Mobile: just show current page label */}
            <span className="sm:hidden text-sm font-medium text-foreground truncate">
              {pageLabel}
            </span>
          </div>

          {/* Desktop: user + logout in topbar */}
          <div className="hidden md:flex items-center gap-2 shrink-0">
            {user && (
              <span className="text-sm text-muted-foreground">{userName}</span>
            )}
            <button
              onClick={logout}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <LogOut className="w-4 h-4" />
              Log out
            </button>
          </div>
        </header>

        {/* Scrollable page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
