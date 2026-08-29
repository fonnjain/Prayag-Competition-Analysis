import { type ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { WorkspaceHeader } from "@workspace/replit-auth-web";
import { Scale, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  localPriceFinderUrl,
  normalizePriceFinderParams,
} from "@/lib/priceFinderRouteState";

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const searchString = useSearch();
  const isComparison = location === "/comparison";
  const currentParams = new URLSearchParams(searchString);
  const searchHref = localPriceFinderUrl(
    "/",
    normalizePriceFinderParams(currentParams, "search"),
  );
  const comparisonHref = localPriceFinderUrl(
    "/comparison",
    normalizePriceFinderParams(currentParams, "comparison"),
  );

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      <WorkspaceHeader activeApp="price-finder" />
      <nav className="border-b bg-card px-4" aria-label="Price Finder navigation">
        <div className="mx-auto flex h-11 w-full max-w-[1600px] items-center gap-2">
          <Link
            href={searchHref}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              !isComparison
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Search className="h-4 w-4" />
            Search products
          </Link>
          <Link
            href={comparisonHref}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              isComparison
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Scale className="h-4 w-4" />
            Compare
          </Link>
        </div>
      </nav>

      <main className="flex-1 w-full relative">
        {children}
      </main>
    </div>
  );
}
