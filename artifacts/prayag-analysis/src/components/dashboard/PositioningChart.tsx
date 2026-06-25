import { useGetAnalysisPositioning } from "@workspace/api-client-react";
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
  Cell
} from "recharts";

export function PositioningChart({ filters }: { filters: DashboardFilters }) {
  const { data, isLoading } = useGetAnalysisPositioning(filters as any);

  if (isLoading || !data) {
    return <Skeleton className="h-[400px] w-full" />;
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Price Positioning Distribution
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.buckets} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
            <YAxis 
              tickLine={false} 
              axisLine={false} 
              tick={{ fontSize: 12 }} 
            />
            <Tooltip 
              cursor={{ fill: "hsl(var(--muted))" }}
              contentStyle={{ borderRadius: "var(--radius)", border: "1px solid hsl(var(--border))" }}
              formatter={(value: number, name: string, props: any) => [
                `${value} SKUs`, 
                props.payload.side === "cheaper" ? "Prayag Cheaper" : props.payload.side === "costlier" ? "Prayag Costlier" : "Parity"
              ]}
            />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {data.buckets.map((entry, index) => {
                let fill = "hsl(var(--muted-foreground))";
                if (entry.side === "cheaper") fill = "hsl(var(--success))";
                else if (entry.side === "costlier") fill = "hsl(var(--destructive))";
                return <Cell key={`cell-${index}`} fill={fill} />;
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
