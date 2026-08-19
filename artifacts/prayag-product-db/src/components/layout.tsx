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
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@workspace/replit-auth-web";

interface LayoutProps {
  children: React.ReactNode;
}

const navItems = [
  { href: "/", label: "Catalog", icon: Box },
  { href: "/comparison", label: "Comparison", icon: BarChart2 },
  { href: "/mapping-review", label: "Mapping Review", icon: LinkIcon },
  { href: "/load-mrp", label: "Load MRP", icon: FileSpreadsheet },
  { href: "/import-competitor", label: "Import Competitor", icon: FileUp },
  { href: "/data-health", label: "Data Health", icon: Database },
  { href: "/api-keys", label: "API Keys", icon: Key },
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

  const navigation = (mobile = false) => (
    <nav className="space-y-1" aria-label="Product Database navigation">
      {navItems.map((item) => {
        const Icon = item.icon;
        return (
          <Link key={item.href} href={item.href} onClick={() => mobile && setMobileNavOpen(false)}>
            <span
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                isActive(item.href)
                  ? "bg-white/90 text-[#174c57] shadow-sm"
                  : "text-white/75 hover:bg-white/10 hover:text-white",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );

  const appSwitcher = (mobile = false) => (
    <div className="space-y-1">
      <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">Switch app</p>
      <a
        href="/"
        onClick={() => mobile && setMobileNavOpen(false)}
        className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-white/75 transition-colors hover:bg-white/10 hover:text-white"
      >
        <Home className="h-4 w-4" />
        Home
      </a>
      <a
        href="/analysis/"
        onClick={() => mobile && setMobileNavOpen(false)}
        className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-white/75 transition-colors hover:bg-white/10 hover:text-white"
      >
        <TrendingUp className="h-4 w-4" />
        Competition Analysis
      </a>
      <a
        href="/price-finder/"
        onClick={() => mobile && setMobileNavOpen(false)}
        className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-white/75 transition-colors hover:bg-white/10 hover:text-white"
      >
        <Search className="h-4 w-4" />
        Price Finder
      </a>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f6f8f7] text-foreground lg:flex">
      <aside className="hidden w-64 shrink-0 flex-col bg-[#164954] text-white lg:flex">
        <div className="border-b border-white/15 px-5 py-5">
          <a href="/" className="flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#5bc5bb] text-[#164954]">
              <LayoutGrid className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-bold tracking-tight">Prayag</span>
              <span className="block text-[11px] text-white/60">Pricing workspace</span>
            </span>
          </a>
        </div>

        <div className="px-4 pt-5">
          <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">Workspace</p>
          <div className="flex items-center gap-2 px-3 pb-3 text-sm font-semibold text-white">
            <Database className="h-4 w-4 text-[#84ded5]" />
            Product Database
          </div>
          {navigation()}
        </div>

        <div className="mt-4 border-t border-white/15 px-4 pt-4">{appSwitcher()}</div>

        <div className="mt-auto border-t border-white/15 p-4">
          <div className="mb-3 flex items-center gap-2 px-1">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#dff1ee] text-[10px] font-bold text-[#164954]">
              {displayName.slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-white">{displayName}</p>
              <p className="text-[11px] text-white/55">Catalog reviewer</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 border-b border-border/80 bg-background/95 backdrop-blur">
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
  );
}