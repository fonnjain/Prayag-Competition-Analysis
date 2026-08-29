import {
  Factory,
  PackageSearch,
  FileSpreadsheet,
  Hexagon,
  BarChart3,
  Scale,
  Search,
  Users,
  ShieldCheck,
} from "lucide-react";
import { useAuth, WorkspaceHeader } from "@workspace/replit-auth-web";

export default function Home() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  return (
    <div className="min-h-screen w-full flex flex-col bg-background">
      <WorkspaceHeader activeApp="home" />

      {/* ── Page body ── */}
      <div className="flex-1 flex flex-col items-center justify-start px-4 py-8 md:justify-center md:py-10 relative overflow-hidden">
        {/* Decorative background elements */}
        <div className="absolute top-0 left-0 w-full h-[400px] bg-gradient-to-b from-primary/10 to-transparent pointer-events-none" />
        <div className="absolute -top-40 -right-40 w-[600px] h-[600px] rounded-full bg-primary/5 blur-3xl pointer-events-none" />
        <div className="absolute top-1/2 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-border to-transparent opacity-50 pointer-events-none" />

        <div className="w-full max-w-5xl relative z-10 animate-in fade-in slide-in-from-bottom-8 duration-700">
          {/* Header Section */}
          <header className="text-center mb-8 space-y-2">
            <div className="mx-auto w-12 h-12 bg-primary rounded-xl flex items-center justify-center shadow-md shadow-primary/20 mb-4 border border-primary/20">
              <Hexagon className="w-6 h-6 text-white" strokeWidth={2} />
            </div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground">
              Prayag Polymers
            </h1>
            <p className="text-sm md:text-base text-muted-foreground max-w-2xl mx-auto font-medium">
              Internal operations hub. Select an application to begin.
            </p>
          </header>

          {/* Apps Grid */}
          <div className="grid md:grid-cols-3 gap-3 max-w-5xl mx-auto">
            {/* Product DB Card */}
            <a
              href="/product-db/"
              className="group relative bg-card rounded-xl p-5 border border-border shadow-sm hover:shadow-lg transition-all duration-300 flex flex-col gap-3 hover:border-primary/30 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              data-testid="link-product-db"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl pointer-events-none" />

              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center text-primary group-hover:scale-105 transition-transform duration-300">
                <PackageSearch className="w-5 h-5" />
              </div>

              <div>
                <h2 className="text-lg font-semibold mb-1 text-foreground group-hover:text-primary transition-colors">
                  Product Database
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Master catalog and MRP history. Manage product data health,
                  perform bulk MRP uploads, and review the comprehensive parts
                  catalog.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 mt-auto pt-3 border-t border-border/50">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <PackageSearch className="w-4 h-4 text-primary/60" />
                  <span>Master Catalog</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <FileSpreadsheet className="w-4 h-4 text-primary/60" />
                  <span>MRP Uploads</span>
                </div>
              </div>
            </a>

            {/* Competition Analysis Card */}
            <a
              href="/analysis/"
              className="group relative bg-card rounded-xl p-5 border border-border shadow-sm hover:shadow-lg transition-all duration-300 flex flex-col gap-3 hover:border-primary/30 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              data-testid="link-analysis"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl pointer-events-none" />

              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center text-primary group-hover:scale-105 transition-transform duration-300">
                <BarChart3 className="w-5 h-5" />
              </div>

              <div>
                <h2 className="text-lg font-semibold mb-1 text-foreground group-hover:text-primary transition-colors">
                  Competition Analysis
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Live competitive pricing dashboard. Measure coverage against
                  rival brands, see where Prayag is cheaper or exposed, and
                  surface margin headroom and threats.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 mt-auto pt-3 border-t border-border/50">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Scale className="w-4 h-4 text-primary/60" />
                  <span>Price Positioning</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <BarChart3 className="w-4 h-4 text-primary/60" />
                  <span>Coverage &amp; Gaps</span>
                </div>
              </div>
            </a>

            {/* Price Finder Card */}
            <a
              href="/price-finder/"
              className="group relative bg-card rounded-xl p-5 border border-border shadow-sm hover:shadow-lg transition-all duration-300 flex flex-col gap-3 hover:border-primary/30 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              data-testid="link-price-finder"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl pointer-events-none" />

              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center text-primary group-hover:scale-105 transition-transform duration-300">
                <Search className="w-5 h-5" />
              </div>

              <div>
                <h2 className="text-lg font-semibold mb-1 text-foreground group-hover:text-primary transition-colors">
                  Price Finder
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Quickly look up current Prayag MRP, upcoming revisions, and
                  competitor price gaps by product code, name, or category.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 mt-auto pt-3 border-t border-border/50">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Search className="w-4 h-4 text-primary/60" />
                  <span>Quick Lookup</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <PackageSearch className="w-4 h-4 text-primary/60" />
                  <span>Voice Search</span>
                </div>
              </div>
            </a>
          </div>

          {/* Admin card — only for admin users */}
          {isAdmin && (
            <div className="mt-4 max-w-5xl mx-auto">
              <a
                href="/admin"
                className="group flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 hover:bg-primary/10 hover:border-primary/40 transition-all outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center text-primary group-hover:scale-110 transition-transform shrink-0">
                  <Users className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground group-hover:text-primary transition-colors">
                      User Management
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      <ShieldCheck className="w-3 h-3" />
                      Admin only
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Add or remove users, reset passwords, and manage roles.
                  </p>
                </div>
              </a>
            </div>
          )}

          {/* Footer */}
          <footer className="mt-8 text-center text-xs text-muted-foreground">
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
