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
import { AlertCircle } from "lucide-react";

export function CoverageMatrix({ filters }: { filters: DashboardFilters }) {
  const { data, isLoading } = useGetAnalysisCoverageMatrix(filters as any);

  if (isLoading || !data) {
    return <Skeleton className="h-[320px] md:h-[360px] w-full" />;
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Competitor Coverage Matrix
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-auto p-3 pt-0 sm:p-4 sm:pt-0">
        <div className="overflow-x-auto">
        <Table className="min-w-[680px]">
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
                <TableCell className="font-medium">
                  <div className="flex flex-col items-start gap-1">
                    <span>{row.competitor}</span>
                    {row.competitor === "Ashirvad" && (
                      <span className="inline-flex items-center gap-1 px-1 py-0.5 text-[9px] font-bold text-amber-800 bg-amber-100/80 border border-amber-200/80 rounded leading-none">
                        <AlertCircle className="w-2.5 h-2.5" />
                        Valid from 01 Mar 2025 (18+ months old)
                      </span>
                    )}
                  </div>
                </TableCell>
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
        </div>
        <div className="mt-3 pt-3 border-t flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-center text-sm">
          <div className="font-semibold text-muted-foreground uppercase tracking-wider">Overall Totals</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono">
            <span>Coverage: <span className="font-bold text-foreground">{data.totals.coveragePct?.toFixed(1) ?? 0}%</span></span>
            <span>Matched: <span className="font-bold text-foreground">{data.totals.matched.toLocaleString()}</span></span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
