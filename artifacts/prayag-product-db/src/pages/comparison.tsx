import { useState, useEffect } from "react";
import { 
  useGetComparison, 
  useGetComparisonSummary, 
  useGetComparisonFilters,
  useGetComparisonMatrix,
  getGetComparisonQueryKey,
  getGetComparisonSummaryQueryKey,
  getGetComparisonMatrixQueryKey
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, ChevronLeft, ChevronRight, CheckCircle2, TrendingDown, Scale, Rows3, Columns3 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

type ViewMode = "rows" | "matrix";

function ConfidenceBadge({ confidence }: { confidence?: string | null }) {
  if (!confidence) return null;
  const tier = confidence.toLowerCase();
  const styles =
    tier === "high"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
      : tier === "medium"
      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
      : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
  return (
    <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide", styles)}>
      {confidence}
    </span>
  );
}

function DiffBadge({ diffPct, prayagCheaper }: { diffPct?: number | null; prayagCheaper?: boolean | null }) {
  if (diffPct == null) return <span className="text-muted-foreground">-</span>;
  return (
    <span className={cn(
      "font-mono font-medium px-2 py-0.5 rounded",
      prayagCheaper ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-destructive dark:bg-red-900/30 dark:text-red-400"
    )}>
      {diffPct > 0 ? "+" : ""}{diffPct.toFixed(1)}%
    </span>
  );
}

export default function ComparisonPage() {
  const [view, setView] = useState<ViewMode>("rows");
  const [search, setSearch] = useState("");
  const [competitor, setCompetitor] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");
  const [matchStatus, setMatchStatus] = useState<string>("all");
  const [confidence, setConfidence] = useState<string>("all");
  const [expensiveOnly, setExpensiveOnly] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [view, search, competitor, category, matchStatus, confidence, expensiveOnly]);

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

  const rowsParams = {
    search: search || undefined,
    competitor: competitor !== "all" ? competitor : undefined,
    category: category !== "all" ? category : undefined,
    matchStatus: matchStatus !== "all" ? matchStatus : undefined,
    confidence: confidence !== "all" ? confidence : undefined,
    expensiveOnly: expensiveOnly ? true : undefined,
    page,
    pageSize: PAGE_SIZE
  };

  const { data: comparisonData, isLoading } = useGetComparison(rowsParams, {
    query: {
      enabled: view === "rows",
      queryKey: getGetComparisonQueryKey(rowsParams)
    }
  });

  const matrixParams = {
    search: search || undefined,
    category: category !== "all" ? category : undefined,
    expensiveOnly: expensiveOnly ? true : undefined,
    page,
    pageSize: PAGE_SIZE
  };

  const { data: matrixData, isLoading: matrixLoading } = useGetComparisonMatrix(matrixParams, {
    query: {
      enabled: view === "matrix",
      queryKey: getGetComparisonMatrixQueryKey(matrixParams)
    }
  });

  const activeData = view === "rows" ? comparisonData : matrixData;
  const activeLoading = view === "rows" ? isLoading : matrixLoading;
  const total = activeData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  const matrixCompetitors = matrixData?.competitors ?? [];

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Market Comparison</h1>
          <p className="text-muted-foreground mt-1">
            Analyze Prayag prices against competitor brands.
          </p>
        </div>
        <div className="inline-flex rounded-md border bg-card p-1">
          <button
            onClick={() => setView("rows")}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors",
              view === "rows" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Rows3 className="w-4 h-4" />
            By competitor
          </button>
          <button
            onClick={() => setView("matrix")}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors",
              view === "matrix" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Columns3 className="w-4 h-4" />
            Side-by-side
          </button>
        </div>
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
            <div className="text-sm text-muted-foreground mb-1">Match Confidence</div>
            {summaryData.confidenceCounts ? (
              <div className="flex items-center gap-3 mt-2">
                <div>
                  <div className="text-xl font-bold font-mono text-emerald-600">{summaryData.confidenceCounts.high}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide">High</div>
                </div>
                <div>
                  <div className="text-xl font-bold font-mono text-amber-600">{summaryData.confidenceCounts.medium}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Med</div>
                </div>
                <div>
                  <div className="text-xl font-bold font-mono text-slate-500">{summaryData.confidenceCounts.low}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Low</div>
                </div>
              </div>
            ) : (
              <div className="text-3xl font-bold font-mono">{summaryData.matchedRows}</div>
            )}
            <div className="text-xs text-muted-foreground mt-1">
              {summaryData.matchedRows} mapped of {summaryData.totalRows} rows
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
        <div className="flex gap-4 flex-wrap">
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search descriptions, codes..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          
          {view === "rows" && (
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
          )}

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

          {view === "rows" && (
            <>
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

              <Select value={confidence} onValueChange={setConfidence}>
                <SelectTrigger className="w-[170px]">
                  <SelectValue placeholder="Confidence" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Confidence</SelectItem>
                  {(filters?.confidences ?? []).map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
        </div>
        
        <div className="flex items-center space-x-2">
          <Switch 
            id="expensiveOnly" 
            checked={expensiveOnly} 
            onCheckedChange={setExpensiveOnly} 
          />
          <Label htmlFor="expensiveOnly" className="text-sm font-normal cursor-pointer">
            {view === "matrix"
              ? "Show only where Prayag is more expensive than a competitor"
              : "Show only where Prayag is more expensive"}
          </Label>
        </div>
      </div>

      <div className="border rounded-md bg-card">
        <div className="overflow-x-auto">
          {view === "rows" ? (
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
                              <div className="flex items-center gap-2">
                                <Link href={`/product/${row.matchedPrayagCode}`}>
                                  <span className="font-medium text-primary hover:underline cursor-pointer">
                                    {row.matchedPrayagCode}
                                  </span>
                                </Link>
                                <ConfidenceBadge confidence={row.matchConfidence} />
                              </div>
                              <div className="text-xs text-muted-foreground truncate max-w-[200px]" title={row.prayagProductName || ""}>
                                {row.prayagProductName}
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                                {row.matchStatus || "Unmatched"}
                              </span>
                              <ConfidenceBadge confidence={row.matchConfidence} />
                            </div>
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
                          <DiffBadge diffPct={row.diffPct} prayagCheaper={row.prayagCheaper} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 font-medium text-muted-foreground">Prayag Product</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-right">Prayag MRP</th>
                  {matrixCompetitors.map((c) => (
                    <th key={c} className="px-4 py-3 font-medium text-muted-foreground text-right">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrixLoading ? (
                  <tr>
                    <td colSpan={2 + matrixCompetitors.length} className="px-4 py-8 text-center text-muted-foreground">Loading side-by-side comparison...</td>
                  </tr>
                ) : (matrixData?.rows.length ?? 0) === 0 ? (
                  <tr>
                    <td colSpan={2 + Math.max(1, matrixCompetitors.length)} className="px-4 py-8 text-center text-muted-foreground">No matched products found.</td>
                  </tr>
                ) : (
                  matrixData?.rows.map((row) => (
                    <tr key={row.prayagCode} className="border-b last:border-0 hover:bg-muted/50 transition-colors align-top">
                      <td className="px-4 py-3">
                        <Link href={`/product/${row.prayagCode}`}>
                          <span className="font-medium text-primary hover:underline cursor-pointer">{row.prayagCode}</span>
                        </Link>
                        <div className="text-xs text-muted-foreground truncate max-w-[260px]" title={row.prayagProductName || ""}>
                          {row.prayagProductName || "-"}
                        </div>
                        {row.category && <div className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{row.category}</div>}
                      </td>
                      <td className="px-4 py-3 text-right font-mono whitespace-nowrap">
                        {row.prayagMrp != null ? `₹${row.prayagMrp.toFixed(2)}` : <span className="text-muted-foreground">-</span>}
                      </td>
                      {matrixCompetitors.map((c) => {
                        const cell = row.cells.find((x) => x.competitor === c);
                        if (!cell || cell.price == null) {
                          return <td key={c} className="px-4 py-3 text-right text-muted-foreground">-</td>;
                        }
                        return (
                          <td key={c} className="px-4 py-3 text-right whitespace-nowrap">
                            <div className="font-mono">₹{cell.price.toFixed(2)}</div>
                            <div className="flex items-center justify-end gap-1.5 mt-1">
                              <DiffBadge diffPct={cell.diffPct} prayagCheaper={cell.prayagCheaper} />
                              <ConfidenceBadge confidence={cell.matchConfidence} />
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
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
            disabled={page <= 1 || activeLoading}
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
            disabled={page >= totalPages || activeLoading}
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
