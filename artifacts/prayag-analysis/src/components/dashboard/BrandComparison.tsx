import { useGetAnalysisByBrand } from "@workspace/api-client-react";
import type { DashboardFilters } from "@/pages/dashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine
} from "recharts";

export function BrandComparison({ filters }: { filters: DashboardFilters }) {
  const { data, isLoading } = useGetAnalysisByBrand(filters as any);

  if (isLoading || !data) {
    return <Skeleton className="h-[400px] w-full" />;
  }

  const chartData = data.map(d => ({
    name: d.competitor,
    avgGap: d.avgPriceDiffPct ?? 0,
    cheaperCount: d.prayagCheaperCount,
    costlierCount: d.prayagCostlierCount,
    totalComparable: d.comparableSkus
  })).sort((a, b) => b.avgGap - a.avgGap);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">By Brand: Avg Price Gap (%)</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
            <YAxis 
              tickFormatter={(val) => `${val}%`} 
              tickLine={false} 
              axisLine={false} 
              tick={{ fontSize: 12 }} 
            />
            <Tooltip 
              cursor={{ fill: "hsl(var(--muted))" }}
              contentStyle={{ borderRadius: "var(--radius)", border: "1px solid hsl(var(--border))" }}
              formatter={(value: number) => [`${value.toFixed(1)}%`, "Avg Gap"]}
            />
            <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeWidth={2} />
            <Bar dataKey="avgGap" radius={[4, 4, 0, 0]}>
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.avgGap >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
