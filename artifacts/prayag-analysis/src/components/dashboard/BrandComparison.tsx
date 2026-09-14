import { useGetAnalysisByBrand } from "@workspace/api-client-react";
import type { DashboardFilters } from "@/pages/dashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle } from "lucide-react";
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

const CustomXAxisTick = (props: any) => {
  const { x, y, payload } = props;
  const isAshirvad = payload.value === "Ashirvad";

  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} dy={16} textAnchor="middle" fill="#666" fontSize={12} className="font-medium">
        {payload.value}
      </text>
      {isAshirvad && (
        <g transform="translate(0, 24)">
          <rect x={-85} y={0} width={170} height={16} rx={4} fill="#fef3c7" stroke="#fde68a" />
          <text x={0} y={11} textAnchor="middle" fill="#92400e" fontSize={9} fontWeight="bold">
            Valid from 01 Mar '25 (18+ months old)
          </text>
        </g>
      )}
    </g>
  );
};

export function BrandComparison({ filters }: { filters: DashboardFilters }) {
  const { data, isLoading } = useGetAnalysisByBrand(filters as any);

  if (isLoading || !data) {
    return <Skeleton className="h-[300px] md:h-[340px] w-full" />;
  }

  const chartData = data.map(d => ({
    name: d.competitor,
    avgGap: d.avgPriceDiffPct,
    cheaperCount: d.prayagCheaperCount,
    costlierCount: d.prayagCostlierCount,
    totalComparable: d.comparableSkus
  })).sort((a, b) => (b.avgGap ?? -Infinity) - (a.avgGap ?? -Infinity));

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">By Brand: Avg Price Gap (%)</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-[220px] p-3 pt-0 sm:p-4 sm:pt-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 25 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey="name" tick={<CustomXAxisTick />} tickLine={false} axisLine={false} interval={0} />
            <YAxis
              tickFormatter={(val) => `${val}%`}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12 }}
            />
            <Tooltip
              cursor={{ fill: "hsl(var(--muted))" }}
              contentStyle={{ borderRadius: "var(--radius)", border: "1px solid hsl(var(--border))" }}
              formatter={(value: any) => [value != null ? `${Number(value).toFixed(1)}%` : "No data", "Avg Gap"]}
            />
            <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeWidth={2} />
            <Bar dataKey="avgGap" radius={[4, 4, 0, 0]}>
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={(entry.avgGap ?? 0) >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
