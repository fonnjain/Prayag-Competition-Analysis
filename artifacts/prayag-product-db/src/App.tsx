import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import NotFound from "@/pages/not-found";
import CatalogPage from "@/pages/catalog";
import ProductDetailPage from "@/pages/product-detail";
import LoadMrpPage from "@/pages/load-mrp";
import DataHealthPage from "@/pages/data-health";
import ComparisonPage from "@/pages/comparison";
import MappingReviewPage from "@/pages/mapping-review";
import ImportCompetitorPage from "@/pages/import-competitor";
import ApiKeysPage from "@/pages/api-keys";
import { useAuth } from "@workspace/replit-auth-web";

const queryClient = new QueryClient();

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated, login } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-semibold">Prayag Product Database</h1>
        <p className="text-muted-foreground">Sign in to continue.</p>
        <button
          onClick={login}
          className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Log in
        </button>
      </div>
    );
  }

  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={CatalogPage} />
      <Route path="/product/:itemCode" component={ProductDetailPage} />
      <Route path="/load-mrp" component={LoadMrpPage} />
      <Route path="/data-health" component={DataHealthPage} />
      <Route path="/comparison" component={ComparisonPage} />
      <Route path="/mapping-review" component={MappingReviewPage} />
      <Route path="/import-competitor" component={ImportCompetitorPage} />
      <Route path="/api-keys" component={ApiKeysPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthGate>
            <Layout>
              <Router />
            </Layout>
          </AuthGate>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
