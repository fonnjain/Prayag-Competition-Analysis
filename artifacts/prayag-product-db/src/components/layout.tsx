import { Link, useLocation } from "wouter";
import { Box, Database, FileSpreadsheet, LayoutGrid, BarChart2, Link as LinkIcon, FileUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Catalog", icon: Box },
    { href: "/comparison", label: "Comparison", icon: BarChart2 },
    { href: "/mapping-review", label: "Mapping Review", icon: LinkIcon },
    { href: "/load-mrp", label: "Load MRP", icon: FileSpreadsheet },
    { href: "/import-competitor", label: "Import Competitor", icon: FileUp },
    { href: "/data-health", label: "Data Health", icon: Database },
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
      </aside>
      
      <main className="flex-1 overflow-auto bg-background">
        <div className="h-full">
          {children}
        </div>
      </main>
    </div>
  );
}
