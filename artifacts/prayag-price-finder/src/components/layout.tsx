import { type ReactNode } from "react";
import { useAuth } from "@workspace/replit-auth-web";
import { Box, Home, LogOut, Search, TrendingUp, Menu, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface LayoutProps {
  children: ReactNode;
}

const navItems = [
  { href: "/", label: "Home", icon: Home },
  { href: "/product-db/", label: "Product Database", icon: Box },
  { href: "/analysis/", label: "Competition Analysis", icon: TrendingUp },
  { href: "/price-finder/", label: "Price Finder", icon: Search, active: true },
];

export function Layout({ children }: LayoutProps) {
  const { user, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email || "User";

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      <header className="sticky top-0 z-40 w-full border-b bg-card">
        <div className="flex h-14 items-center px-4 md:px-6">
          <div className="flex items-center gap-2 md:gap-4 flex-1">
            {/* Mobile menu toggle */}
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden flex items-center justify-center h-9 w-9 rounded-md text-muted-foreground hover:bg-muted"
              aria-label="Open navigation"
              aria-expanded={mobileMenuOpen}
              aria-controls="price-finder-mobile-navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
            
            {/* Branding / App Name */}
            <div className="flex items-center gap-3">
              <div className="bg-primary text-primary-foreground h-8 w-8 rounded-lg flex items-center justify-center font-bold shadow-sm">
                <Search className="h-4 w-4" />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-bold leading-none tracking-tight">Prayag</span>
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest leading-tight">
                  Price Finder
                </span>
              </div>
            </div>
            
            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center ml-8 gap-1">
              {navItems.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  aria-current={item.active ? "page" : undefined}
                  className={cn(
                    "px-3 py-2 text-sm font-medium rounded-md transition-colors",
                    item.active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </div>
                </a>
              ))}
            </nav>
          </div>

          {/* User & Actions */}
          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">{displayName}</span>
              <button 
                onClick={logout}
                className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-muted-foreground hover:bg-destructive hover:text-destructive-foreground transition-colors"
                title="Log out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} />
          <div id="price-finder-mobile-navigation" className="relative flex w-full max-w-xs flex-col bg-card shadow-xl h-full animate-in slide-in-from-left duration-200">
            <div className="flex h-14 items-center justify-between px-4 border-b">
              <span className="text-sm font-bold">Prayag</span>
              <button onClick={() => setMobileMenuOpen(false)} className="text-muted-foreground h-9 w-9 flex items-center justify-center rounded-md hover:bg-muted" aria-label="Close navigation">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-4">
              <div className="px-4 pb-2 mb-2 border-b">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Current App</p>
                <div className="flex items-center gap-2 text-sm font-bold bg-primary/10 text-primary px-3 py-2 rounded-md">
                  <Search className="h-4 w-4" />
                  Price Finder
                </div>
              </div>
              <div className="px-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-4 mb-2">Switch App</p>
                <nav className="space-y-1">
                  {navItems.map((item) => (
                    <a
                      key={item.href}
                      href={item.href}
                      aria-current={item.active ? "page" : undefined}
                      onClick={() => setMobileMenuOpen(false)}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md",
                        item.active
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </a>
                  ))}
                </nav>
              </div>
            </div>
            <div className="p-4 border-t bg-muted/50">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{displayName}</span>
                <button 
                  onClick={logout}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 w-full relative">
        {children}
      </main>
    </div>
  );
}
