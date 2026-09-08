import { useGetAnalysisByCategory } from "@workspace/api-client-react";
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

export function CategoryComparison({ filters }: { filters: DashboardFilters }) {
  const { data, isLoading } = useGetAnalysisByCategory(filters as any);

  if (isLoading || !data) {
    return <Skeleton className="h-[320px] md:h-[360px] w-full" />;
  }

  // Sort by avg gap descending
  const chartData = [...data].sort((a, b) => (b.avgPriceDiffPct ?? -Infinity) - (a.avgPriceDiffPct ?? -Infinity));

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          By Category: Avg Price Gap (%)
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-[250px] p-3 pt-0 sm:p-4 sm:pt-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
            <XAxis type="number" tickFormatter={(val) => `${val}%`} tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
            <YAxis 
              type="category" 
              dataKey="category" 
              tickLine={false} 
              axisLine={false} 
              tick={{ fontSize: 11 }} 
              width={100}
            />
            <Tooltip 
              cursor={{ fill: "hsl(var(--muted))" }}
              contentStyle={{ borderRadius: "var(--radius)", border: "1px solid hsl(var(--border))" }}
              formatter={(value: any) => [value != null ? `${Number(value).toFixed(1)}%` : "No data", "Avg Gap"]}
            />
            <ReferenceLine x={0} stroke="hsl(var(--muted-foreground))" strokeWidth={2} />
            <Bar dataKey="avgPriceDiffPct" radius={[0, 4, 4, 0]} barSize={20}>
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={(entry.avgPriceDiffPct ?? 0) >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
