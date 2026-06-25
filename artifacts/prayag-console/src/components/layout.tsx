import { Link, useLocation } from "wouter";
import { LayoutDashboard, Upload, Users, Settings, Target, BarChart3, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/recommendations", label: "Recommendations", icon: Target },
  { href: "/import", label: "Import Data", icon: Upload },
  { href: "/competitors", label: "Competitors", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      <aside className="w-full md:w-64 border-r border-border bg-sidebar flex-shrink-0 flex flex-col">
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-primary-foreground font-bold">
              P
            </div>
            <div>
              <h1 className="font-bold text-sidebar-foreground leading-tight">Prayag Console</h1>
              <p className="text-xs text-muted-foreground">Pricing Intelligence</p>
            </div>
          </div>
        </div>
        
        <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const isActive = location === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}

          <a
            href="/analysis/"
            className="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            data-testid="link-analysis"
          >
            <BarChart3 className="w-4 h-4" />
            <span className="flex-1">Competition Analysis</span>
            <ExternalLink className="w-3 h-3 opacity-50" />
          </a>
        </nav>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
