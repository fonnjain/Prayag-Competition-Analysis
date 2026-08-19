import { useState, useEffect } from "react";
import { 
  useGetComparison, 
  useGetComparisonByProduct,
  useGetComparisonSummary, 
  useGetComparisonFilters,
  getGetComparisonQueryKey,
  getGetComparisonByProductQueryKey,
  getGetComparisonSummaryQueryKey
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, ChevronLeft, ChevronRight, CheckCircle2, TrendingDown, Scale, Rows3, Columns3, Trophy, Download, AlertTriangle, Ruler } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { PriceWindowDetails } from "@/components/price-window";

const PAGE_SIZE = 50;

type ViewMode = "byProduct" | "byCompetitor";

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

const MARKET_POSITION_META: Record<string, { label: string; styles: string }> = {
  leader: {
    label: "Leader",
    styles: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  },
  competitive: {
    label: "Competitive",
    styles: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  },
  above_market: {
    label: "Above Market",
    styles: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  },
  overpriced: {
    label: "Overpriced",
    styles: "bg-red-100 text-destructive dark:bg-red-900/30 dark:text-red-400",
  },
};

function MarketPositionBadge({ position }: { position?: string | null }) {
  const meta = position ? MARKET_POSITION_META[position] : undefined;
  if (!meta) return <span className="text-muted-foreground">-</span>;
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap", meta.styles)}>
      {meta.label}
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

function AmbiguousBadge({ note }: { note?: string | null }) {
  return (
    <span
      title={note || "Unit basis is ambiguous — needs manual review"}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 whitespace-nowrap cursor-help"
    >
      <AlertTriangle className="w-3 h-3" />
      Review
    </span>
  );
}

export default function ComparisonPage() {
  const [view, setView] = useState<ViewMode>("byProduct");
  const [search, setSearch] = useState("");
  const [competitor, setCompetitor] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");
  const [matchStatus, setMatchStatus] = useState<string>("all");
  const [confidence, setConfidence] = useState<string>("all");
  const [expensiveOnly, setExpensiveOnly] = useState(false);
  const [ambiguousOnly, setAmbiguousOnly] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [view, search, competitor, category, matchStatus, confidence, expensiveOnly, ambiguousOnly]);

  // The ambiguous filter only exists on the by-competitor list endpoint.
  useEffect(() => {
    if (view === "byProduct" && ambiguousOnly) setAmbiguousOnly(false);
  }, [view, ambiguousOnly]);

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
    ambiguousOnly: ambiguousOnly ? true : undefined,
    page,
    pageSize: PAGE_SIZE
  };

  const { data: comparisonData, isLoading: rowLoading } = useGetComparison(rowsParams, {
    query: {
      enabled: view === "byCompetitor",
      queryKey: getGetComparisonQueryKey(rowsParams)
    }
  });

  const productParams = {
    search: search || undefined,
    category: category !== "all" ? category : undefined,
    expensiveOnly: expensiveOnly ? true : undefined,
    page,
    pageSize: PAGE_SIZE
  };

  const { data: productData, isLoading: productLoading } = useGetComparisonByProduct(productParams, {
    query: {
      enabled: view === "byProduct",
      queryKey: getGetComparisonByProductQueryKey(productParams)
    }
  });

  const isLoading = view === "byProduct" ? productLoading : rowLoading;
  const activeLoading = isLoading;
  const total = (view === "byProduct" ? productData?.total : comparisonData?.total) ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  const exportUrl = (format: "csv" | "xlsx") => {
    const params = new URLSearchParams({ format });
    if (search) params.set("search", search);
    if (competitor !== "all") params.set("competitor", competitor);
    if (category !== "all") params.set("category", category);
    if (matchStatus !== "all") params.set("matchStatus", matchStatus);
    if (confidence !== "all") params.set("confidence", confidence);
    if (expensiveOnly) params.set("expensiveOnly", "true");
    if (ambiguousOnly) params.set("ambiguousOnly", "true");
    return `/api/catalog/comparison/export?${params.toString()}`;
  };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Market Comparison</h1>
          <p className="text-muted-foreground mt-1">
            Analyze Prayag prices against competitor brands.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border bg-card p-1">
            <button
              onClick={() => setView("byProduct")}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors",
                view === "byProduct" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Columns3 className="w-4 h-4" />
              By Product
            </button>
            <button
              onClick={() => setView("byCompetitor")}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors",
                view === "byCompetitor" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Rows3 className="w-4 h-4" />
              By Competitor Row
            </button>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Download className="w-4 h-4 mr-2" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <a href={exportUrl("xlsx")} download>Excel (.xlsx)</a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={exportUrl("csv")} download>CSV (.csv)</a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {!summaryLoading && summaryData && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
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

          <div className="bg-card border rounded-lg p-5">
            <div className="text-sm text-muted-foreground mb-1 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Needs Review
            </div>
            <div className="text-3xl font-bold font-mono text-amber-600">
              {summaryData.ambiguousCount ?? 0}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Ambiguous unit basis (per pc/mtr/ft)
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
          
          {view === "byCompetitor" && (
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

          {view === "byCompetitor" && (
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
        
        <div className="flex items-center gap-6 flex-wrap">
          <div className="flex items-center space-x-2">
            <Switch
              id="expensiveOnly"
              checked={expensiveOnly}
              onCheckedChange={setExpensiveOnly}
            />
            <Label htmlFor="expensiveOnly" className="text-sm font-normal cursor-pointer">
              {view === "byProduct"
                ? "Show only where Prayag is more expensive than a competitor"
                : "Show only where Prayag is more expensive"}
            </Label>
          </div>
          {view === "byCompetitor" && (
            <div className="flex items-center space-x-2">
              <Switch
                id="ambiguousOnly"
                checked={ambiguousOnly}
                onCheckedChange={setAmbiguousOnly}
              />
              <Label htmlFor="ambiguousOnly" className="text-sm font-normal cursor-pointer flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                Show only ambiguous-unit rows (needs review)
              </Label>
            </div>
          )}
        </div>
      </div>

      {view === "byProduct" ? (
        <div className="border rounded-md bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 font-medium text-muted-foreground sticky left-0 bg-muted/50 z-10">Prayag Product</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-right">Prayag MRP</th>
                  {(productData?.competitors ?? []).map((c) => (
                    <th key={c} className="px-4 py-3 font-medium text-muted-foreground text-right whitespace-nowrap">{c}</th>
                  ))}
                  <th className="px-4 py-3 font-medium text-muted-foreground text-right whitespace-nowrap">Market (min · med · max)</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-center whitespace-nowrap">Position</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-right whitespace-nowrap">Cheapest Rival</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-right">Diff %</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={(productData?.competitors.length ?? 0) + 6} className="px-4 py-8 text-center text-muted-foreground">Loading comparison...</td>
                  </tr>
                ) : (productData?.rows.length ?? 0) === 0 ? (
                  <tr>
                    <td colSpan={(productData?.competitors.length ?? 0) + 6} className="px-4 py-8 text-center text-muted-foreground">No matched products found. Map competitor rows on the Mapping Review page.</td>
                  </tr>
                ) : (
                  productData?.rows.map((row) => {
                    const cellByComp = new Map(row.competitors.map((c) => [c.competitor, c]));
                    return (
                      <tr key={row.itemCode} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                        <td className="px-4 py-3 sticky left-0 bg-card z-10">
                          <Link href={`/product/${row.itemCode}`}>
                            <span className="font-medium text-primary hover:underline cursor-pointer">{row.itemCode}</span>
                          </Link>
                          <div className="text-xs text-muted-foreground truncate max-w-[200px]" title={row.prayagProductName || ""}>
                            {row.prayagProductName || row.category || ""}
                          </div>
                          {row.lengthNormalized && (
                            <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-sky-700 dark:text-sky-400">
                              <Ruler className="w-3 h-3" />
                              per-metre basis
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {row.prayagMrp != null ? (
                            <>
                              <span className={cn(row.prayagLowest && "text-green-600 font-semibold")}>₹{row.prayagMrp.toFixed(2)}</span>
                              {row.prayagPerMetre != null && (
                                <div className="mt-0.5 text-[11px] text-muted-foreground">
                                  ₹{row.prayagPerMetre.toFixed(2)}/m
                                </div>
                              )}
                              <PriceWindowDetails
                                compact
                                currentPrice={row.prayagMrp}
                                validFrom={row.prayagEffectiveDate}
                                validTo={row.prayagValidTo}
                                upcomingPrice={row.upcomingPrayagMrp}
                                upcomingEffectiveDate={row.upcomingPrayagEffectiveDate}
                                upcomingChangePct={row.upcomingPrayagChangePct}
                                className="mt-1 min-w-[190px]"
                              />
                            </>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                        {(productData?.competitors ?? []).map((comp) => {
                          const cell = cellByComp.get(comp);
                          if (!cell) {
                            return <td key={comp} className="px-4 py-3 text-right text-muted-foreground">-</td>;
                          }
                          return (
                            <td key={comp} className="px-4 py-3 text-right font-mono whitespace-nowrap">
                              <span className={cn(
                                "inline-flex items-center gap-1 px-1.5 py-0.5 rounded",
                                cell.isCheapest && "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 font-semibold"
                              )}>
                                {cell.isCheapest && <Trophy className="w-3 h-3" />}
                                ₹{cell.price.toFixed(2)}
                              </span>
                              {cell.perMetre != null && (
                                <div className="mt-0.5 text-[11px] text-muted-foreground">
                                  ₹{cell.perMetre.toFixed(2)}/m
                                </div>
                              )}
                              <PriceWindowDetails
                                compact
                                currentPrice={cell.price}
                                validFrom={cell.effectiveDate}
                                validTo={cell.validTo}
                                upcomingPrice={cell.upcomingPrice}
                                upcomingEffectiveDate={cell.upcomingEffectiveDate}
                                upcomingChangePct={cell.upcomingChangePct}
                                className="mt-1 min-w-[190px]"
                              />
                              <div className="mt-1 flex justify-end">
                                {cell.unitAmbiguous ? (
                                  <AmbiguousBadge />
                                ) : (
                                  <DiffBadge diffPct={cell.diffPct} prayagCheaper={cell.diffPct != null ? cell.diffPct > 0 : null} />
                                )}
                              </div>
                            </td>
                          );
                        })}
                        <td className="px-4 py-3 text-right font-mono whitespace-nowrap">
                          {row.marketMin != null && row.marketMax != null ? (
                            <div>
                              <div className="text-sm">
                                ₹{row.marketMin.toFixed(2)}
                                <span className="text-muted-foreground"> · </span>
                                <span className="font-semibold">₹{row.marketMedian!.toFixed(2)}</span>
                                <span className="text-muted-foreground"> · </span>
                                ₹{row.marketMax.toFixed(2)}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {row.rivalCount} {row.rivalCount === 1 ? "brand" : "brands"}
                              </div>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <MarketPositionBadge position={row.marketPosition} />
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {row.cheapestRival != null ? (
                            <div>
                              <div className="font-semibold">₹{row.cheapestRival.toFixed(2)}</div>
                              <div className="text-xs text-muted-foreground">{row.cheapestRivalName}</div>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {row.diffPct != null ? (
                            <span className={cn(
                              "font-mono font-medium px-2 py-0.5 rounded",
                              row.prayagLowest ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-destructive dark:bg-red-900/30 dark:text-red-400"
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
      ) : (
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
                          {row.compPerMetre != null && (
                            <div className="mt-0.5 text-[11px] text-muted-foreground">
                              ₹{row.compPerMetre.toFixed(2)}/m
                            </div>
                          )}
                          <PriceWindowDetails
                            compact
                            currentPrice={row.competitorPrice}
                            validFrom={row.effectiveDate}
                            validTo={row.competitorValidTo}
                            upcomingPrice={row.upcomingCompetitorPrice}
                            upcomingEffectiveDate={row.upcomingCompetitorEffectiveDate}
                            upcomingChangePct={row.upcomingCompetitorChangePct}
                            className="mt-1 min-w-[190px]"
                          />
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
                            <>
                              <span className="font-mono">₹{row.prayagMrp.toFixed(2)}</span>
                              {row.prayagPerMetre != null && (
                                <div className="mt-0.5 text-[11px] text-muted-foreground font-mono">
                                  ₹{row.prayagPerMetre.toFixed(2)}/m
                                </div>
                              )}
                              <PriceWindowDetails
                                compact
                                currentPrice={row.prayagMrp}
                                validFrom={row.prayagEffectiveDate}
                                validTo={row.prayagValidTo}
                                upcomingPrice={row.upcomingPrayagMrp}
                                upcomingEffectiveDate={row.upcomingPrayagEffectiveDate}
                                upcomingChangePct={row.upcomingPrayagChangePct}
                                className="mt-1 min-w-[190px]"
                              />
                            </>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {row.unitAmbiguous ? (
                            <AmbiguousBadge note={row.normalizationNote} />
                          ) : (
                            <DiffBadge
                              diffPct={row.effectiveDiffPct}
                              prayagCheaper={row.effectivePrayagCheaper}
                            />
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
      )}

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
