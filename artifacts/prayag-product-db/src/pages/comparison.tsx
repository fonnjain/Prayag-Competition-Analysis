import { useState, useEffect } from "react";
import { 
  useGetComparison, 
  useGetComparisonSummary, 
  useGetComparisonFilters,
  getGetComparisonQueryKey,
  getGetComparisonSummaryQueryKey
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, ChevronLeft, ChevronRight, CheckCircle2, TrendingDown, Scale } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

export default function ComparisonPage() {
  const [search, setSearch] = useState("");
  const [competitor, setCompetitor] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");
  const [matchStatus, setMatchStatus] = useState<string>("all");
  const [expensiveOnly, setExpensiveOnly] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [search, competitor, category, matchStatus, expensiveOnly]);

  const { data: filters } = useGetComparisonFilters();
  
  const { data: summaryData, isLoading: summaryLoading } = useGetComparisonSummary({
    competitor: competitor !== "all" ? competitor : undefined,
  }, {
    query: {
      queryKey: getGetComparisonSummaryQueryKey({
        competitor: competitor !== "all" ? competitor : undefined
      })
    }
  });

  const { data: comparisonData, isLoading } = useGetComparison({
    search: search || undefined,
    competitor: competitor !== "all" ? competitor : undefined,
    category: category !== "all" ? category : undefined,
    matchStatus: matchStatus !== "all" ? matchStatus : undefined,
    expensiveOnly: expensiveOnly ? true : undefined,
    page,
    pageSize: PAGE_SIZE
  }, {
    query: {
      queryKey: getGetComparisonQueryKey({
        search: search || undefined,
        competitor: competitor !== "all" ? competitor : undefined,
        category: category !== "all" ? category : undefined,
        matchStatus: matchStatus !== "all" ? matchStatus : undefined,
        expensiveOnly: expensiveOnly ? true : undefined,
        page,
        pageSize: PAGE_SIZE
      })
    }
  });

  const total = comparisonData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Market Comparison</h1>
        <p className="text-muted-foreground mt-1">
          Analyze Prayag prices against competitor brands.
        </p>
      </div>

      {!summaryLoading && summaryData && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-card border rounded-lg p-5">
            <div className="text-sm text-muted-foreground mb-1 flex items-center gap-2">
              <Scale className="w-4 h-4" />
              Competitive Share
            </div>
            <div className="text-3xl font-bold font-mono">
              {summaryData.prayagCheaperPct != null ? `${summaryData.prayagCheaperPct.toFixed(1)}%` : "N/A"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Prayag is cheaper or equal
            </div>
          </div>
          
          <div className="bg-card border rounded-lg p-5">
            <div className="text-sm text-muted-foreground mb-1 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              Winning Products
            </div>
            <div className="text-3xl font-bold font-mono text-green-600">
              {summaryData.prayagCheaperCount}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Out of {summaryData.comparableRows} comparable
            </div>
          </div>

          <div className="bg-card border rounded-lg p-5">
            <div className="text-sm text-muted-foreground mb-1 flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-primary" />
              Avg Savings
            </div>
            <div className="text-3xl font-bold font-mono">
              {summaryData.avgDiffPct != null ? `${Math.abs(summaryData.avgDiffPct).toFixed(1)}%` : "0%"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Average difference when cheaper
            </div>
          </div>

          <div className="bg-card border rounded-lg p-5">
            <div className="text-sm text-muted-foreground mb-1">Total Mapped Rows</div>
            <div className="text-3xl font-bold font-mono">
              {summaryData.matchedRows}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Out of {summaryData.totalRows} competitor rows
            </div>
          </div>
        </div>
      )}

      {/* Category breakdown */}
      {!summaryLoading && summaryData && summaryData.categoryWinRates.length > 0 && (
        <div className="mb-8">
          <h3 className="text-sm font-semibold mb-3 uppercase tracking-wider text-muted-foreground">Category Win Rates</h3>
          <div className="flex flex-wrap gap-2">
            {summaryData.categoryWinRates.map((cat) => (
              <div key={cat.category} className="bg-muted/40 border rounded-md px-3 py-2 text-sm flex items-center gap-2">
                <span className="font-medium">{cat.category}</span>
                <span className="text-muted-foreground text-xs">{cat.comparable} items</span>
                <span className={cn(
                  "font-mono font-medium ml-1",
                  (cat.prayagCheaperPct || 0) >= 50 ? "text-green-600" : "text-destructive"
                )}>
                  {cat.prayagCheaperPct != null ? `${cat.prayagCheaperPct.toFixed(0)}%` : "0%"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4 mb-6">
        <div className="flex gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search descriptions, codes..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          
          <Select value={competitor} onValueChange={setCompetitor}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Competitor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Competitors</SelectItem>
              {(filters?.competitors ?? []).map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {(filters?.categories ?? []).map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={matchStatus} onValueChange={setMatchStatus}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {(filters?.matchStatuses ?? []).map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        <div className="flex items-center space-x-2">
          <Switch 
            id="expensiveOnly" 
            checked={expensiveOnly} 
            onCheckedChange={setExpensiveOnly} 
          />
          <Label htmlFor="expensiveOnly" className="text-sm font-normal cursor-pointer">
            Show only where Prayag is more expensive
          </Label>
        </div>
      </div>

      <div className="border rounded-md bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 font-medium text-muted-foreground">Competitor</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Description</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Size</th>
                <th className="px-4 py-3 font-medium text-muted-foreground text-right">Comp Price</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Prayag Match</th>
                <th className="px-4 py-3 font-medium text-muted-foreground text-right">Prayag MRP</th>
                <th className="px-4 py-3 font-medium text-muted-foreground text-right">Diff %</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Loading comparison...</td>
                </tr>
              ) : comparisonData?.rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No matching records found.</td>
                </tr>
              ) : (
                comparisonData?.rows.map((row) => {
                  const isMapped = row.matchedPrayagCode && row.matchStatus === "matched";
                  
                  return (
                    <tr key={row.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium">{row.competitor}</div>
                        <div className="text-xs text-muted-foreground">{row.category}</div>
                      </td>
                      <td className="px-4 py-3 truncate max-w-[200px]" title={row.description || ""}>
                        {row.description || "-"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{row.size || "-"}</td>
                      <td className="px-4 py-3 text-right font-mono">
                        ₹{row.competitorPrice?.toFixed(2)}
                        {row.unit && <span className="text-xs text-muted-foreground ml-1">/{row.unit}</span>}
                      </td>
                      <td className="px-4 py-3">
                        {isMapped ? (
                          <div>
                            <Link href={`/product/${row.matchedPrayagCode}`}>
                              <span className="font-medium text-primary hover:underline cursor-pointer">
                                {row.matchedPrayagCode}
                              </span>
                            </Link>
                            <div className="text-xs text-muted-foreground truncate max-w-[200px]" title={row.prayagProductName || ""}>
                              {row.prayagProductName}
                            </div>
                          </div>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                            {row.matchStatus || "Unmatched"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {row.prayagMrp != null ? (
                          <span className="font-mono">₹{row.prayagMrp.toFixed(2)}</span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {row.diffPct != null ? (
                          <span className={cn(
                            "font-mono font-medium px-2 py-0.5 rounded",
                            row.prayagCheaper ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-destructive dark:bg-red-900/30 dark:text-red-400"
                          )}>
                            {row.diffPct > 0 ? "+" : ""}{row.diffPct.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between mt-4">
        <p className="text-sm text-muted-foreground font-mono">
          {total === 0 ? "0 results" : `${rangeStart}–${rangeEnd} of ${total}`}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || isLoading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground font-mono px-2">
            Page {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages || isLoading}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
}
