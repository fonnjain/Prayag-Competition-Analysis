import { useEffect } from "react";
import { useGetAnalysisOverview } from "@workspace/api-client-react";
import type { DashboardFilters } from "@/pages/dashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  TrendingDown, TrendingUp, Minus, 
  Target, Layers, PackageSearch 
} from "lucide-react";

export function OverviewCards({
  filters,
  onPrayagMrpDate,
  onCompetitorPeriodDate,
}: {
  filters: DashboardFilters;
  onPrayagMrpDate?: (date: string | null) => void;
  // undefined = data not yet loaded; null = loaded but no competitor data; string = date
  onCompetitorPeriodDate?: (date: string | null | undefined) => void;
}) {
  const { data, isLoading } = useGetAnalysisOverview(filters as any);

  useEffect(() => {
    onPrayagMrpDate?.(data?.prayagMrpDate ?? null);
  }, [data?.prayagMrpDate, onPrayagMrpDate]);

  useEffect(() => {
    // Only publish null (triggering the "no data" chip) once we have a confirmed
    // successful response.  While data is undefined (loading or error), pass
    // undefined so the chip stays hidden — not "No competitor data".
    onCompetitorPeriodDate?.(
      data === undefined
        ? undefined
        : ((data as any).competitorPeriodDate ?? null),
    );
  }, [data, onCompetitorPeriodDate]);

  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32 w-full" />)}
      </div>
    );
  }

  const {
    coveragePct,
    comparableSkus,
    prayagCheaperCount,
    prayagCostlierCount,
    prayagCheaperPct,
    avgPriceDiffPct,
    medianPriceDiffPct,
    totalSkus,
    matchedSkus,
  } = data;

  const isPositive = (avgPriceDiffPct || 0) > 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Market Coverage</CardTitle>
          <Target className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{coveragePct?.toFixed(1) ?? 0}%</div>
          <p className="text-xs text-muted-foreground mt-1">
            {matchedSkus.toLocaleString()} / {totalSkus.toLocaleString()} SKUs matched
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Pricing Position</CardTitle>
          <Layers className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-positive">
            {prayagCheaperPct?.toFixed(1) ?? 0}%
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Prayag cheaper in {prayagCheaperCount.toLocaleString()} / {comparableSkus.toLocaleString()} comparable
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Avg Price Gap</CardTitle>
          {isPositive ? <TrendingUp className="h-4 w-4 text-positive" /> : <TrendingDown className="h-4 w-4 text-negative" />}
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold ${isPositive ? 'text-positive' : 'text-negative'}`}>
            {avgPriceDiffPct != null ? (avgPriceDiffPct > 0 ? "+" : "") + avgPriceDiffPct.toFixed(1) + "%" : "N/A"}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Positive means Prayag has margin headroom
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Median Gap</CardTitle>
          <PackageSearch className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {medianPriceDiffPct != null ? (medianPriceDiffPct > 0 ? "+" : "") + medianPriceDiffPct.toFixed(1) + "%" : "N/A"}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Across {comparableSkus.toLocaleString()} comparable items
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
