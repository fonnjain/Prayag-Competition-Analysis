import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';
import { AuthProvider, PasswordChangeGate } from '@workspace/replit-auth-web';
import { Layout } from '@/components/layout';
import { BrowseProvider } from '@/lib/browseContext';
import PriceFinderPage from '@/pages/home';
import ComparisonPage from '@/pages/comparison';

import BucketListsPage from '@/pages/bucket-lists';
import BucketEditorPage from '@/pages/bucket-editor';

const queryClient = new QueryClient();

function Router() {
  return (
    <BrowseProvider>
      <RoutedErrorBoundary>
        <Layout>
          <Switch>
            <Route path="/" component={PriceFinderPage} />
            <Route path="/comparison" component={ComparisonPage} />
            <Route path="/bucket-lists" component={BucketListsPage} />
            <Route path="/bucket-lists/edit" component={BucketEditorPage} />
            <Route component={NotFound} />
          </Switch>
        </Layout>
      </RoutedErrorBoundary>
    </BrowseProvider>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <AuthProvider appSlug="price-finder">
            <PasswordChangeGate>
              <Router />
            </PasswordChangeGate>
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
