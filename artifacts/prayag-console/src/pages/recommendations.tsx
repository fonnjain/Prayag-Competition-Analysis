import { useGetRecommendations, getGetRecommendationsQueryKey, useGetCategories } from "@workspace/api-client-react";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPrice, formatPct } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Recommendations() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("");

  const { data: categories } = useGetCategories();
  
  const queryParams = { 
    search: search || undefined,
    category: category && category !== "all" ? category : undefined,
  };
  
  const { data: recs, isLoading } = useGetRecommendations(queryParams, { query: { queryKey: getGetRecommendationsQueryKey(queryParams) } });

  const exportUrl = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/export?type=recommendations&format=xlsx`;

  return (
    <div className="flex-1 p-6 space-y-6 overflow-y-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-primary">Pricing Recommendations</h2>
          <p className="text-muted-foreground text-sm">Data-driven suggestions to improve competitiveness without sacrificing margin.</p>
        </div>
        <Button asChild>
          <a href={exportUrl} download>
            <Download className="w-4 h-4 mr-2" />
            Export Suggestions
          </a>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Suggested Price Adjustments</CardTitle>
          <CardDescription>Review and apply these suggested prices to reach target competitiveness.</CardDescription>
          <div className="flex flex-col sm:flex-row gap-4 pt-4">
            <div className="w-full sm:w-64">
              <Input 
                placeholder="Search code or size..." 
                value={search} 
                onChange={(e) => setSearch(e.target.value)} 
              />
            </div>
            <div className="w-full sm:w-48">
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {categories?.map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto relative">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="sticky left-0 bg-muted/95 backdrop-blur z-20 font-semibold border-r">Item Code</TableHead>
                  <TableHead className="font-semibold">Category</TableHead>
                  <TableHead className="text-right font-semibold">Current Price</TableHead>
                  <TableHead className="text-right font-semibold">Market Median</TableHead>
                  <TableHead className="text-right font-semibold text-primary">Suggested Target</TableHead>
                  <TableHead className="text-right font-semibold">Gap to Close</TableHead>
                  <TableHead className="text-center font-semibold">Margin Check</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({length: 5}).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={7}><Skeleton className="h-8 w-full" /></TableCell>
                    </TableRow>
                  ))
                ) : recs?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">No recommendations found.</TableCell>
                  </TableRow>
                ) : recs?.map((rec) => (
                  <TableRow key={rec.itemCode}>
                    <TableCell className="font-mono text-xs font-medium sticky left-0 bg-background z-10 border-r">{rec.itemCode}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{rec.category}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{formatPrice(rec.currentPrice)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{formatPrice(rec.marketMedian)}</TableCell>
                    <TableCell className="text-right font-mono text-sm font-bold text-primary bg-primary/5">{formatPrice(rec.suggestedPrice)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {rec.gapPct != null ? (
                        <span className={cn(
                          "px-2 py-0.5 rounded-full inline-block",
                          rec.gapPct < 0 ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"
                        )}>
                          {rec.gapPct > 0 ? '+' : ''}{rec.gapPct.toFixed(1)}%
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-center text-xs">
                      {rec.marginConstrained ? (
                        <span className="text-warning font-medium" title="Target adjusted to maintain minimum margin">Constrained</span>
                      ) : (
                        <span className="text-success" title="Target meets margin requirements">Healthy</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
