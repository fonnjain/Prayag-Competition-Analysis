import { type ReactNode } from "react";
import { useLocation } from "wouter";
import { WorkspaceHeader } from "@workspace/replit-auth-web";
import { Scale, Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const isComparison = location === "/comparison";

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      <WorkspaceHeader activeApp="price-finder" />
      <nav className="border-b bg-card px-4" aria-label="Price Finder navigation">
        <div className="mx-auto flex h-11 w-full max-w-[1600px] items-center gap-2">
          <a
            href="/price-finder/"
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              !isComparison
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Search className="h-4 w-4" />
            Search products
          </a>
          <a
            href="/price-finder/comparison"
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              isComparison
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Scale className="h-4 w-4" />
            Compare
          </a>
        </div>
      </nav>

      <main className="flex-1 w-full relative">
        {children}
      </main>
    </div>
  );
}
