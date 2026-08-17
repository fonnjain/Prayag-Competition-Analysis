import { Link, useLocation } from "wouter";
import { Box, Database, FileSpreadsheet, LayoutGrid, BarChart2, Link as LinkIcon, FileUp, Key, LogOut, Home, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@workspace/replit-auth-web";

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const navItems = [
    { href: "/", label: "Catalog", icon: Box },
    { href: "/comparison", label: "Comparison", icon: BarChart2 },
    { href: "/mapping-review", label: "Mapping Review", icon: LinkIcon },
    { href: "/load-mrp", label: "Load MRP", icon: FileSpreadsheet },
    { href: "/import-competitor", label: "Import Competitor", icon: FileUp },
    { href: "/data-health", label: "Data Health", icon: Database },
    { href: "/api-keys", label: "API Keys", icon: Key },
  ];

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      <aside className="w-64 flex-shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col">
        <div className="p-6">
          <div className="flex items-center gap-3 text-sidebar-foreground">
            <LayoutGrid className="w-6 h-6 text-sidebar-primary" />
            <span className="font-bold tracking-tight text-lg">Prayag DB</span>
          </div>
        </div>
        
        <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer",
                    isActive 
                      ? "bg-sidebar-accent text-sidebar-accent-foreground" 
                      : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Cross-app navigation */}
        <div className="px-4 pb-2 pt-2 border-t border-sidebar-border mt-2 space-y-1">
          <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/40">Other Apps</p>
          <a
            href="/"
            className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
          >
            <Home className="w-4 h-4" />
            Home
          </a>
          <a
            href="/analysis/"
            className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
          >
            <TrendingUp className="w-4 h-4" />
            Competition Analysis
          </a>
        </div>

        {/* User / logout */}
        <div className="px-4 pb-4 pt-2 border-t border-sidebar-border mt-2">
          {user && (
            <p className="text-xs text-sidebar-foreground/50 truncate px-3 mb-1">{[user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "User"}</p>
          )}
          <button
            onClick={logout}
            className="flex w-full items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Log out
          </button>
        </div>
      </aside>
      
      <main className="flex-1 overflow-auto bg-background">
        <div className="h-full">
          {children}
        </div>
      </main>
    </div>
  );
}
