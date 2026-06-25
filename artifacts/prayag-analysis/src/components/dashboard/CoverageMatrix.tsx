import { useGetAnalysisCoverageMatrix } from "@workspace/api-client-react";
import type { DashboardFilters } from "@/pages/dashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export function CoverageMatrix({ filters }: { filters: DashboardFilters }) {
  const { data, isLoading } = useGetAnalysisCoverageMatrix(filters as any);

  if (isLoading || !data) {
    return <Skeleton className="h-[400px] w-full" />;
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Competitor Coverage Matrix
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-semibold">Competitor</TableHead>
              <TableHead className="text-right">Total SKUs</TableHead>
              <TableHead className="text-right">Matched</TableHead>
              <TableHead className="text-right">Coverage</TableHead>
              <TableHead className="text-right">High Conf</TableHead>
              <TableHead className="text-right">Med Conf</TableHead>
              <TableHead className="text-right">Low Conf</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((row) => (
              <TableRow key={row.competitor}>
                <TableCell className="font-medium">{row.competitor}</TableCell>
                <TableCell className="text-right">{row.total.toLocaleString()}</TableCell>
                <TableCell className="text-right">{row.matched.toLocaleString()}</TableCell>
                <TableCell className="text-right font-medium">
                  {row.coveragePct?.toFixed(1) ?? 0}%
                </TableCell>
                <TableCell className="text-right text-success">{row.high.toLocaleString()}</TableCell>
                <TableCell className="text-right text-muted-foreground">{row.medium.toLocaleString()}</TableCell>
                <TableCell className="text-right text-destructive">{row.low.toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="mt-4 pt-4 border-t flex justify-between items-center text-sm">
          <div className="font-semibold text-muted-foreground uppercase tracking-wider">Overall Totals</div>
          <div className="flex gap-4 font-mono">
            <span>Coverage: <span className="font-bold text-foreground">{data.totals.coveragePct?.toFixed(1) ?? 0}%</span></span>
            <span>Matched: <span className="font-bold text-foreground">{data.totals.matched.toLocaleString()}</span></span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
