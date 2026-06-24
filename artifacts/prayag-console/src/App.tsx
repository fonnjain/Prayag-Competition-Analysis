import { AppLayout } from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import Recommendations from "@/pages/recommendations";
import ImportPage from "@/pages/import";
import Competitors from "@/pages/competitors";
import Settings from "@/pages/settings";
import NotFound from "@/pages/not-found";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

const queryClient = new QueryClient();

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/recommendations" component={Recommendations} />
        <Route path="/import" component={ImportPage} />
        <Route path="/competitors" component={Competitors} />
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
