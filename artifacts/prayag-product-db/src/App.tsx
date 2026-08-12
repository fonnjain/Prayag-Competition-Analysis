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

const queryClient = new QueryClient();

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
          <Layout>
            <Router />
          </Layout>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
