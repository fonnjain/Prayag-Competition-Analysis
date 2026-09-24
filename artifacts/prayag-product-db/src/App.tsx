import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import NotFound from "@/pages/not-found";
import CatalogPage from "@/pages/catalog";
import ProductDetailPage from "@/pages/product-detail";
import LoadMrpPage from "@/pages/load-mrp";
import NewProductsPage from "@/pages/new-products";
import DataHealthPage from "@/pages/data-health";
import ComparisonPage from "@/pages/comparison";
import MappingReviewPage from "@/pages/mapping-review";
import ImportCompetitorPage from "@/pages/import-competitor";
import ImportReviewPage from "@/pages/import-review";
import ApiKeysPage from "@/pages/api-keys";
import MrpRevisionsPage from "@/pages/mrp-revisions";
import PriceEditorPage from "@/pages/price-editor";
import MrpProvenanceBackfillPage from "@/pages/mrp-provenance-backfill";
import NameChangesPage from "@/pages/name-changes";
import { useAuth, AuthProvider, PasswordChangeGate } from "@workspace/replit-auth-web";
import { useEffect, useState } from "react";

const queryClient = new QueryClient();

function LoginForm() {
  const { loginWithPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const result = await loginWithPassword(email, password);
    setLoading(false);
    if (!result.ok) setError(result.error ?? "Invalid credentials");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30">
      <div className="w-full max-w-sm rounded-xl border bg-background p-8 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold">Prayag Product Database</h1>
        <p className="mb-6 text-sm text-muted-foreground">Sign in to continue</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Email</label>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Password</label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated, user } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!isAuthenticated) return <LoginForm />;
  if (user?.role === "counter" || user?.role === "user") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-muted/30 p-6 text-center">
        <h1 className="text-xl font-semibold">Product Database is not available to sales accounts</h1>
        <p className="max-w-md text-sm text-muted-foreground">Use Price Finder to search products or compare selected prices.</p>
        <div className="flex flex-wrap justify-center gap-3">
          <a href="/price-finder/" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Open Price Finder</a>
          <a href="/price-finder/comparison" className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent">Open Compare</a>
        </div>
      </div>
    );
  }

  return <PasswordChangeGate>{children}</PasswordChangeGate>;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={CatalogPage} />
      <Route path="/product" component={ProductDetailPage} />
      <Route path="/product/:itemCode" component={ProductDetailPage} />
      <Route path="/load-mrp" component={LoadMrpPage} />
      <Route path="/new-products" component={NewProductsPage} />
      <Route path="/data-health" component={DataHealthPage} />
      <Route path="/comparison" component={ComparisonPage} />
      <Route path="/mapping-review" component={MappingReviewPage} />
      <Route path="/import-competitor" component={ImportCompetitorPage} />
      <Route path="/import-review/:id" component={ImportReviewPage} />
      <Route path="/api-keys" component={ApiKeysPage} />
      <Route path="/mrp-revisions" component={MrpRevisionsPage} />
      <Route path="/price-editor" component={PriceEditorPage} />
      <Route path="/mrp-provenance-backfill" component={MrpProvenanceBackfillPage} />
      <Route path="/name-changes" component={NameChangesPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function PriceFinderRedirect() {
  useEffect(() => {
    window.location.replace(
      `/price-finder/${window.location.search}${window.location.hash}`,
    );
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-muted-foreground">Opening Price Finder…</p>
    </div>
  );
}

function App() {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const legacyProductPrefix = `${basePath}/product/`;
  if (window.location.pathname.startsWith(legacyProductPrefix)) {
    const encodedRemainder = window.location.pathname.slice(
      legacyProductPrefix.length,
    );
    let itemCode = encodedRemainder;
    try {
      itemCode = decodeURIComponent(encodedRemainder);
    } catch {
      // Preserve the literal path remainder; the query route treats item codes
      // as opaque values and can still show a useful not-found response.
    }
    const search = new URLSearchParams(window.location.search);
    search.set("itemCode", itemCode);
    window.history.replaceState(
      null,
      "",
      `${basePath}/product?${search.toString()}${window.location.hash}`,
    );
  }

  const isLegacyPriceFinderUrl =
    window.location.pathname.replace(/\/+$/, "") ===
    "/product-db/price-finder";

  if (isLegacyPriceFinderUrl) return <PriceFinderRedirect />;

  return (
    <AuthProvider appSlug="product-db">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={basePath}>
            <AuthGate>
              <Layout>
                <Router />
              </Layout>
            </AuthGate>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;
