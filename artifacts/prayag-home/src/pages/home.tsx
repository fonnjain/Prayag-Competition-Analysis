import {
  Factory,
  PackageSearch,
  FileSpreadsheet,
  Hexagon,
  BarChart3,
  Scale,
  Search,
  LogOut,
  Home as HomeIcon,
  Menu,
  X,
} from "lucide-react";
import React, { useState } from "react";
import { useAuth } from "@workspace/replit-auth-web";
import { cn } from "@/lib/utils";

const APP_LINKS = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/product-db/", label: "Product Database", icon: PackageSearch },
  { href: "/analysis/", label: "Competition Analysis", icon: BarChart3 },
  { href: "/price-finder/", label: "Price Finder", icon: Search },
] as const;

export default function Home() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const userName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    user?.email ||
    "User";

  return (
    <div className="min-h-screen w-full flex flex-col bg-background">
      {/* ── Workspace header ── */}
      <header className="border-b bg-card text-card-foreground sticky top-0 z-20 shadow-sm">
        <div className="flex items-center justify-between px-4 h-14 max-w-[1600px] mx-auto w-full">
          {/* Brand */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-7 h-7 bg-primary rounded-lg flex items-center justify-center shadow-sm">
              <Hexagon className="w-4 h-4 text-white" strokeWidth={2} />
            </div>
            <div className="leading-none">
              <span className="font-bold text-sm text-foreground">Prayag</span>
              <span className="text-[10px] text-muted-foreground block">
                Pricing workspace
              </span>
            </div>
          </div>

          {/* Desktop nav */}
          <nav
            className="hidden md:flex items-center gap-1"
            aria-label="Workspace navigation"
          >
            {APP_LINKS.map((link) => {
              const Icon = link.icon;
              const isHome = link.href === "/";
              return (
                <a
                  key={link.href}
                  href={link.href}
                  aria-current={isHome ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1",
                    isHome
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {link.label}
                </a>
              );
            })}
          </nav>

          {/* Right side: user + logout + mobile menu toggle */}
          <div className="flex items-center gap-2">
            {user && (
              <span className="text-sm text-muted-foreground hidden sm:block">
                {userName}
              </span>
            )}
            <button
              onClick={logout}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Log out</span>
            </button>
            {/* Mobile menu toggle */}
            <button
              className="md:hidden flex items-center justify-center rounded-md p-1.5 text-foreground hover:bg-accent transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              onClick={() => setMenuOpen((o) => !o)}
            >
              {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile nav dropdown */}
        {menuOpen && (
          <nav
            id="mobile-nav"
            className="md:hidden border-t bg-card px-4 pb-3 pt-2 flex flex-col gap-1"
            aria-label="Workspace navigation"
          >
            {APP_LINKS.map((link) => {
              const Icon = link.icon;
              const isHome = link.href === "/";
              return (
                <a
                  key={link.href}
                  href={link.href}
                  aria-current={isHome ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary",
                    isHome
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  )}
                  onClick={() => setMenuOpen(false)}
                >
                  <Icon className="w-4 h-4" />
                  {link.label}
                </a>
              );
            })}
          </nav>
        )}
      </header>

      {/* ── Page body ── */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 relative overflow-hidden">
        {/* Decorative background elements */}
        <div className="absolute top-0 left-0 w-full h-[400px] bg-gradient-to-b from-primary/10 to-transparent pointer-events-none" />
        <div className="absolute -top-40 -right-40 w-[600px] h-[600px] rounded-full bg-primary/5 blur-3xl pointer-events-none" />
        <div className="absolute top-1/2 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-border to-transparent opacity-50 pointer-events-none" />

        <div className="w-full max-w-4xl relative z-10 animate-in fade-in slide-in-from-bottom-8 duration-700">
          {/* Header Section */}
          <header className="text-center mb-16 space-y-4">
            <div className="mx-auto w-16 h-16 bg-primary rounded-2xl flex items-center justify-center shadow-lg shadow-primary/20 mb-8 border border-primary/20">
              <Hexagon className="w-8 h-8 text-white" strokeWidth={2} />
            </div>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-foreground">
              Prayag Polymers
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto font-medium">
              Internal operations hub. Select an application to begin.
            </p>
          </header>

          {/* Apps Grid */}
          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {/* Product DB Card */}
            <a
              href="/product-db/"
              className="group relative bg-card rounded-2xl p-8 border border-border shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col gap-6 hover:border-primary/30 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              data-testid="link-product-db"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl pointer-events-none" />

              <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center text-primary group-hover:scale-110 transition-transform duration-300">
                <PackageSearch className="w-6 h-6" />
              </div>

              <div>
                <h2 className="text-2xl font-semibold mb-2 text-foreground group-hover:text-primary transition-colors">
                  Product Database
                </h2>
                <p className="text-muted-foreground leading-relaxed">
                  Master catalog and MRP history. Manage product data health,
                  perform bulk MRP uploads, and review the comprehensive parts
                  catalog.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4 mt-auto pt-6 border-t border-border/50">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <PackageSearch className="w-4 h-4 text-primary/60" />
                  <span>Master Catalog</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FileSpreadsheet className="w-4 h-4 text-primary/60" />
                  <span>MRP Uploads</span>
                </div>
              </div>
            </a>

            {/* Competition Analysis Card */}
            <a
              href="/analysis/"
              className="group relative bg-card rounded-2xl p-8 border border-border shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col gap-6 hover:border-primary/30 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              data-testid="link-analysis"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl pointer-events-none" />

              <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center text-primary group-hover:scale-110 transition-transform duration-300">
                <BarChart3 className="w-6 h-6" />
              </div>

              <div>
                <h2 className="text-2xl font-semibold mb-2 text-foreground group-hover:text-primary transition-colors">
                  Competition Analysis
                </h2>
                <p className="text-muted-foreground leading-relaxed">
                  Live competitive pricing dashboard. Measure coverage against
                  rival brands, see where Prayag is cheaper or exposed, and
                  surface margin headroom and threats.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4 mt-auto pt-6 border-t border-border/50">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Scale className="w-4 h-4 text-primary/60" />
                  <span>Price Positioning</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <BarChart3 className="w-4 h-4 text-primary/60" />
                  <span>Coverage &amp; Gaps</span>
                </div>
              </div>
            </a>

            {/* Price Finder Card */}
            <a
              href="/price-finder/"
              className="group relative bg-card rounded-2xl p-8 border border-border shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col gap-6 hover:border-primary/30 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              data-testid="link-price-finder"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl pointer-events-none" />

              <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center text-primary group-hover:scale-110 transition-transform duration-300">
                <Search className="w-6 h-6" />
              </div>

              <div>
                <h2 className="text-2xl font-semibold mb-2 text-foreground group-hover:text-primary transition-colors">
                  Price Finder
                </h2>
                <p className="text-muted-foreground leading-relaxed">
                  Quickly look up current Prayag MRP, upcoming revisions, and
                  competitor price gaps by product code, name, or category.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4 mt-auto pt-6 border-t border-border/50">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Search className="w-4 h-4 text-primary/60" />
                  <span>Quick Lookup</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <PackageSearch className="w-4 h-4 text-primary/60" />
                  <span>Voice Search</span>
                </div>
              </div>
            </a>
          </div>

          {/* Footer */}
          <footer className="mt-20 text-center text-sm text-muted-foreground">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Factory className="w-4 h-4" />
              <span className="font-medium">Prayag Polymers</span>
            </div>
            <p>Internal Operations Network &copy; {new Date().getFullYear()}</p>
          </footer>
        </div>
      </div>
    </div>
  );
}
