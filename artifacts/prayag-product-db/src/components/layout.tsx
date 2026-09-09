import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowLeft,
  BarChart2,
  Box,
  Database,
  FileSpreadsheet,
  FileUp,
  Home,
  Key,
  LayoutGrid,
  Link as LinkIcon,
  LogOut,
  Menu,
  Search,
  TrendingUp,
  PencilLine,
  Users,
  X,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth, WorkspaceHeader } from "@workspace/replit-auth-web";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface LayoutProps {
  children: React.ReactNode;
}

const navItems = [
  { href: "/", label: "Catalog", icon: Box },
  { href: "/comparison", label: "Comparison", icon: BarChart2 },
  { href: "/mapping-review", label: "Mapping Review", icon: LinkIcon },
  { href: "/load-mrp", label: "Load MRP", icon: FileSpreadsheet },
  { href: "/mrp-revisions", label: "Price Revisions", icon: PencilLine, adminOnly: true },
  { href: "/import-competitor", label: "Import Competitor", icon: FileUp },
  { href: "/data-health", label: "Data Health", icon: Database },
  { href: "/api-keys", label: "API Keys", icon: Key, adminOnly: true },
  { href: "/admin", label: "User Management", icon: Users, adminOnly: true, external: true },
];

function getPageContext(location: string) {
  if (location.startsWith("/product/")) {
    return { label: "Product details", parent: "Catalog", fallback: "/" };
  }
  if (location.startsWith("/import-review/")) {
    return { label: "Review import", parent: "Import Competitor", fallback: "/import-competitor" };
  }
  const page = navItems.find((item) => item.href === location);
  return {
    label: page?.label ?? "Product Database",
    parent: "Product Database",
    fallback: "/",
  };
}

export function Layout({ children }: LayoutProps) {
  const [location, navigate] = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const hadInAppNavigation = useRef(false);
  const initialLocation = useRef(location);
  const { user, logout } = useAuth();
  const context = getPageContext(location);
  const isRoot = location === "/";
  const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email || "User";

  useEffect(() => {
    if (location !== initialLocation.current) hadInAppNavigation.current = true;
  }, [location]);

  const goBack = () => {
    if (hadInAppNavigation.current) {
      window.history.back();
      return;
    }
    navigate(context.fallback);
  };

  const isActive = (href: string) => location === href || (href !== "/" && location.startsWith(href));
  const visibleNavItems = navItems.filter((item) => !item.adminOnly || user?.role === "admin");

  const navigation = (mobile = false) => (
    <nav className="space-y-1" aria-label="Product Database navigation">
      {visibleNavItems.map((item) => {
        const Icon = item.icon;
        const active = isActive(item.href);
        const content = (
          <span
            className={cn(
              "flex items-center rounded-lg transition-colors",
              !mobile && isCollapsed ? "justify-center p-2.5" : "gap-3 px-3 py-2.5 text-sm font-medium",
              active
                ? "bg-white/90 text-[#174c57] shadow-sm"
                : "text-white/75 hover:bg-white/10 hover:text-white"
            )}
          >
            <Icon className="h-5 w-5 shrink-0" />
            {(!isCollapsed || mobile) && <span>{item.label}</span>}
          </span>
        );

        const link = item.external ? (
          <a key={item.href} href={item.href} onClick={() => mobile && setMobileNavOpen(false)} aria-label={isCollapsed && !mobile ? item.label : undefined}>
            {content}
          </a>
        ) : (
          <Link key={item.href} href={item.href} onClick={() => mobile && setMobileNavOpen(false)} aria-label={isCollapsed && !mobile ? item.label : undefined}>
            {content}
          </Link>
        );

        if (!mobile && isCollapsed) {
          return (
            <Tooltip key={item.href} delayDuration={0}>
              <TooltipTrigger asChild>{link}</TooltipTrigger>
              <TooltipContent side="right" sideOffset={14}>{item.label}</TooltipContent>
            </Tooltip>
          );
        }

        return link;
      })}
    </nav>
  );

  const appSwitcher = (mobile = false) => (
    <div className="space-y-1">
      {(!isCollapsed || mobile) && <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">Switch app</p>}
      {[
        { href: "/", icon: Home, label: "Home" },
        { href: "/analysis/", icon: TrendingUp, label: "Competition Analysis" },
        { href: "/price-finder/", icon: Search, label: "Price Finder" },
      ].map((app) => {
        const content = (
          <span
            className={cn(
              "flex items-center rounded-lg transition-colors text-white/75 hover:bg-white/10 hover:text-white",
              !mobile && isCollapsed ? "justify-center p-2.5" : "gap-3 px-3 py-2 text-sm font-medium"
            )}
          >
            <app.icon className="h-5 w-5 shrink-0" />
            {(!isCollapsed || mobile) && <span>{app.label}</span>}
          </span>
        );

        const link = (
          <a key={app.href} href={app.href} onClick={() => mobile && setMobileNavOpen(false)} aria-label={isCollapsed && !mobile ? app.label : undefined}>
            {content}
          </a>
        );

        if (!mobile && isCollapsed) {
          return (
            <Tooltip key={app.href} delayDuration={0}>
              <TooltipTrigger asChild>{link}</TooltipTrigger>
              <TooltipContent side="right" sideOffset={14}>{app.label}</TooltipContent>
            </Tooltip>
          );
        }

        return link;
      })}
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f6f8f7] text-foreground">
      <WorkspaceHeader activeApp="product-database" />
      <div className="min-h-[calc(100vh-3.5rem)] lg:flex">
      <aside className={cn(
        "hidden shrink-0 flex-col bg-[#164954] text-white lg:flex transition-all duration-300",
        isCollapsed ? "w-[68px]" : "w-64"
      )}>
        <div className={cn("border-b border-white/15 px-4 py-5 flex items-center", isCollapsed ? "justify-center" : "")}>
          <a href="/" className="flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#5bc5bb] text-[#164954]">
              <LayoutGrid className="h-5 w-5" />
            </span>
            {!isCollapsed && (
              <span className="min-w-0">
                <span className="block text-sm font-bold tracking-tight truncate">Prayag</span>
                <span className="block text-[11px] text-white/60 truncate">Pricing workspace</span>
              </span>
            )}
          </a>
        </div>

        <div className="px-3 pt-5">
          {!isCollapsed && <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">Workspace</p>}
          <div className={cn("flex items-center pb-3 text-sm font-semibold text-white", isCollapsed ? "justify-center" : "px-3 gap-2")}>
            <Database className={cn("text-[#84ded5]", isCollapsed ? "h-5 w-5" : "h-4 w-4")} />
            {!isCollapsed && <span className="truncate">Product Database</span>}
          </div>
          {navigation()}
        </div>

        <div className="mt-4 border-t border-white/15 px-3 pt-4">{appSwitcher()}</div>

        <div className="mt-auto border-t border-white/15 p-3">
          <div className={cn("mb-3 flex items-center", isCollapsed ? "justify-center" : "px-1 gap-2")}>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#dff1ee] text-[10px] font-bold text-[#164954]">
              {displayName.slice(0, 2).toUpperCase()}
            </span>
            {!isCollapsed && (
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-white">{displayName}</p>
                <p className="text-[11px] text-white/55 truncate">Catalog reviewer</p>
              </div>
            )}
          </div>

          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className={cn(
              "flex w-full items-center rounded-lg py-2 text-sm font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white mb-2",
              isCollapsed ? "justify-center px-0" : "gap-3 px-3"
            )}
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? <PanelLeftOpen className="h-5 w-5 shrink-0" /> : <PanelLeftClose className="h-5 w-5 shrink-0" />}
            {!isCollapsed && <span>Collapse</span>}
          </button>

          <button
            onClick={logout}
            className={cn(
              "flex w-full items-center rounded-lg py-2 text-sm font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
              isCollapsed ? "justify-center px-0" : "gap-3 px-3"
            )}
            title={isCollapsed ? "Log out" : undefined}
            aria-label={isCollapsed ? "Log out" : undefined}
          >
            <LogOut className="h-5 w-5 shrink-0" />
            {!isCollapsed && <span>Log out</span>}
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="border-b border-border/80 bg-background/95 backdrop-blur">
          <div className="flex min-h-16 items-center gap-3 px-4 sm:px-6">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[#164954] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:hidden"
              aria-label="Open navigation"
              aria-expanded={mobileNavOpen}
              aria-controls="product-db-mobile-navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
              {!isRoot && (
                <>
                  <button
                    type="button"
                    onClick={goBack}
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-medium text-[#246b71] hover:bg-[#e8f4f2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back
                  </button>
                  <span className="text-border">/</span>
                </>
              )}
              <a href="/product-db/" className="font-medium hover:text-foreground">Product Database</a>
              {!isRoot && (
                <>
                  <span className="text-border">/</span>
                  {context.parent !== "Product Database" && (
                    <>
                      <Link href={context.fallback} className="font-medium hover:text-foreground">
                        {context.parent}
                      </Link>
                      <span className="text-border">/</span>
                    </>
                  )}
                  <span className="font-semibold text-foreground">{context.label}</span>
                </>
              )}
            </div>
            <div className="min-w-0 sm:hidden">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#2d7c78]">Product Database</p>
              <p className="truncate text-sm font-semibold">{context.label}</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {!isRoot && (
                <button
                  type="button"
                  onClick={goBack}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-[#246b71] hover:bg-[#e8f4f2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:hidden"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back
                </button>
              )}
              <span className="hidden text-xs text-muted-foreground md:block">{displayName}</span>
            </div>
          </div>
        </header>

        <main className="min-w-0">{children}</main>
      </div>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/45"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close navigation"
          />
          <aside
            id="product-db-mobile-navigation"
            className="relative flex h-full w-[min(19rem,85vw)] flex-col bg-[#164954] text-white shadow-2xl"
            aria-label="Product Database navigation"
          >
            <div className="flex items-center justify-between border-b border-white/15 px-5 py-5">
              <a href="/" onClick={() => setMobileNavOpen(false)} className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#5bc5bb] text-[#164954]">
                  <LayoutGrid className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-sm font-bold">Prayag</span>
                  <span className="block text-[11px] text-white/60">Pricing workspace</span>
                </span>
              </a>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="rounded-lg p-2 text-white/75 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                aria-label="Close navigation"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-5">
              <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">Workspace</p>
              <p className="px-3 pb-3 text-sm font-semibold">Product Database</p>
              {navigation(true)}
              <div className="mt-5 border-t border-white/15 pt-4">{appSwitcher(true)}</div>
            </div>
            <div className="border-t border-white/15 p-4">
              <p className="mb-2 truncate px-3 text-xs text-white/60">{displayName}</p>
              <button
                onClick={logout}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-white/75 hover:bg-white/10"
              >
                <LogOut className="h-4 w-4" />
                Log out
              </button>
            </div>
          </aside>
        </div>
      )}
      </div>
    </div>
  );
}