import { formatMoney } from "@workspace/formatting";
import { BucketPageHeader } from "@/components/BucketSlot";
import { useEffect, useMemo } from "react";
import { useSearch, useLocation, Link } from "wouter";
import {
  useGetPriceFinderComparison,
  getExportPriceFinderComparisonUrl,
  useGetPriceFinderCompetitors,
  getGetPriceFinderCompetitorsQueryKey,
} from "@workspace/api-client-react";
import { ChevronLeft, Download, Info, AlertCircle, TrendingDown, TrendingUp, Minus, Search, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useAuth } from "@workspace/replit-auth-web";
import { useSelection } from "@/lib/useSelection";
import { formatPriceDate, UpcomingGapDetails } from "@/components/price-window";
import {
  comparisonStateFromParams,
  hasUnsupportedParams,
  localPriceFinderUrl,
  normalizePriceFinderParams,
  filterAvailableCompetitors,
  type PriceFinderCompetitor,
  updateComparisonParams,
} from "@/lib/priceFinderRouteState";

export default function ComparisonPage() {
  const searchString = useSearch();
  const [, setLocation] = useLocation();
  const { codes, removeCode } = useSelection();
  const { user } = useAuth();
  const params = new URLSearchParams(searchString);
  const { competitors: requestedCompetitors, asOf } = comparisonStateFromParams(params);

  // Offered brands come from the server, scoped to the exact selected codes.
  const competitorParams = { itemCode: codes, asOf: asOf || undefined };
  const competitorsQuery = useGetPriceFinderCompetitors(competitorParams, {
    query: {
      queryKey: getGetPriceFinderCompetitorsQueryKey(competitorParams),
      enabled: codes.length > 0,
    },
  });
  const coveredCompetitors = useMemo(
    () => (competitorsQuery.data?.competitors ?? []).filter((c) => c.pricedProducts > 0),
    [competitorsQuery.data],
  );
  const coveredNamesKey = coveredCompetitors.map((c) => c.competitor).join("\u0000");
  const requestedKey = requestedCompetitors.join("\u0000");
  // Unknown / uncovered URL brands are dropped silently. With nothing valid
  // requested, every covered brand is shown (no hardcoded default brand).
  const activeCompetitors = useMemo<PriceFinderCompetitor[]>(() => {
    const names = coveredCompetitors.map((c) => c.competitor);
    const valid = filterAvailableCompetitors(requestedCompetitors, names);
    return valid.length ? valid : names;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coveredNamesKey, requestedKey]);
  const competitorsReady = competitorsQuery.isSuccess;
  const normalizedParams = normalizePriceFinderParams(params, "comparison");
  const normalizedSearch = normalizedParams.toString();

  useEffect(() => {
    if (searchString !== normalizedSearch || hasUnsupportedParams(params)) {
      setLocation(localPriceFinderUrl("/comparison", normalizedParams), {
        replace: true,
      });
    }
  }, [normalizedSearch, searchString, setLocation]);

  const updateFilters = (
    newCompetitors: readonly PriceFinderCompetitor[],
    newAsOf: string,
  ) => {
    const next = updateComparisonParams(params, newCompetitors, newAsOf);
    setLocation(localPriceFinderUrl("/comparison", next));
  };

  const handleCompetitorToggle = (comp: PriceFinderCompetitor) => {
    const current = new Set(activeCompetitors);
    if (current.has(comp)) {
      if (current.size === 1) return;
      current.delete(comp);
    }
    else current.add(comp);
    updateFilters(Array.from(current), asOf);
  };

  const { data, isLoading, isError } = useGetPriceFinderComparison(
    { 
      code: codes, 
      competitor: activeCompetitors,
      asOf: asOf || undefined 
    },
    {
      query: {
        queryKey: ["price-finder-comparison", codes, activeCompetitors, asOf],
        enabled: codes.length > 0 && competitorsReady && activeCompetitors.length > 0,
      }
    }
  );

  const exportUrl = getExportPriceFinderComparisonUrl({
    code: codes,
    competitor: activeCompetitors,
    asOf: asOf || undefined
  });

  if (codes.length === 0) {
    return (
      <div className="max-w-4xl mx-auto p-8 text-center">
        <BucketPageHeader title={<h1 className="text-2xl font-bold text-left">Product Comparison</h1>} />
        <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
          <Search className="w-8 h-8 text-muted-foreground" />
        </div>
        <div className="mb-2 flex items-center justify-between gap-3 text-left">
          <h2 className="text-2xl font-bold">No Products Selected</h2>
        </div>
        <p className="text-muted-foreground mb-6">Select products from the Price Finder to compare them.</p>
        <Link href={localPriceFinderUrl("/", normalizePriceFinderParams(params, "search"))} className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 bg-primary text-primary-foreground hover:bg-primary/90 h-10 py-2 px-4 shadow-sm">
          Go to Price Finder
        </Link>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      <div className="bg-gradient-to-r from-indigo-950 via-slate-900 to-slate-900 text-white shrink-0">
        <div className="max-w-[1600px] mx-auto px-4 py-3 md:px-6 md:py-3.5">
          <BucketPageHeader title={<h1 className="text-xl md:text-2xl font-black tracking-tight text-white">Product Comparison</h1>} />
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-indigo-300 mb-1">
              <Link href={localPriceFinderUrl("/", normalizePriceFinderParams(params, "search"))} className="hover:text-white transition-colors flex items-center gap-1 text-xs font-semibold">
                <ChevronLeft className="w-3.5 h-3.5" /> Back to Search
              </Link>
            </div>
            <p className="text-indigo-200 mt-0.5 text-xs font-medium">
              Comparing {codes.length} selected product{codes.length > 1 ? "s" : ""}
            </p>
          </div>
          
          <div className="flex flex-wrap items-center gap-3 bg-slate-800/80 p-2 rounded-lg border border-white/10 shadow-sm">
            <div className="flex flex-wrap items-center gap-3 border-r border-white/10 pr-3" data-testid="row-competitor-filters">
              {competitorsQuery.isLoading ? (
                <span className="flex items-center gap-2" aria-busy="true">
                  <span className="h-3.5 w-20 rounded bg-white/10 animate-pulse" />
                  <span className="h-3.5 w-16 rounded bg-white/10 animate-pulse" />
                </span>
              ) : competitorsQuery.isError ? (
                <button
                  type="button"
                  onClick={() => competitorsQuery.refetch()}
                  className="text-xs font-semibold text-rose-200 hover:text-white underline underline-offset-2"
                  data-testid="button-retry-competitors"
                >
                  Could not load competitors. Retry
                </button>
              ) : coveredCompetitors.length === 0 ? (
                <span className="text-xs font-semibold text-slate-300" data-testid="text-no-competitors">
                  No competitor prices recorded for this selection.
                </span>
              ) : (
                coveredCompetitors.map(({ competitor: comp, pricedProducts }) => (
                  <label key={comp} className="flex items-center gap-1.5 cursor-pointer group text-xs font-semibold text-slate-200 hover:text-white transition-colors" data-testid={`checkbox-competitor-${comp}`}>
                    <Checkbox
                      checked={activeCompetitors.includes(comp)}
                      onCheckedChange={() => handleCompetitorToggle(comp)}
                      className="h-3.5 w-3.5 border-indigo-400/50 data-[state=checked]:bg-indigo-500 data-[state=checked]:border-indigo-500 rounded"
                    />
                    <span>{comp}</span>
                    <span className="tabular-nums text-indigo-300/80">({pricedProducts})</span>
                  </label>
                ))
              )}
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="asOf" className="text-xs font-semibold text-slate-300">As of</Label>
              <Input 
                id="asOf"
                type="date"
                value={asOf}
                onChange={e => updateFilters(activeCompetitors, e.target.value)}
                className="h-8 w-[132px] bg-slate-950/50 border-white/10 text-white focus-visible:ring-indigo-500 font-medium text-xs"
              />
            </div>
            <Link
              href={`/bucket-lists/edit?${codes.map((c) => `code=${encodeURIComponent(c)}`).join("&")}`}
              data-testid="link-save-as-bucket"
              className="inline-flex items-center gap-1.5 border border-white/30 text-white px-3 h-8 rounded-md text-xs font-bold hover:bg-white/10"
            >
              Save these {codes.length} products as a bucket list
            </Link>
            <a 
              href={exportUrl}
              download
              className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white px-3.5 h-8 rounded-md text-xs font-bold transition-colors shadow ml-auto lg:ml-1"
            >
              <Download className="w-3.5 h-3.5" /> Export Excel
            </a>
          </div>
          </div>
        </div>
      </div>

      <div className="flex-1 w-full mx-auto p-2.5 md:p-3.5 overflow-hidden flex flex-col bg-slate-50 dark:bg-background">
        {competitorsReady && coveredCompetitors.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3 bg-white dark:bg-card rounded-xl border shadow-sm">
            <Info className="w-10 h-10 opacity-50" />
            <p className="font-medium">No competitor prices recorded for this selection.</p>
          </div>
        ) : isLoading || competitorsQuery.isLoading ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground animate-pulse font-medium">
            <Search className="w-5 h-5 mr-2 opacity-50" /> Loading comparison data...
          </div>
        ) : isError || competitorsQuery.isError ? (
          <div className="flex-1 flex flex-col items-center justify-center text-destructive gap-3 bg-red-50 dark:bg-red-950/20 rounded-xl border border-red-100 dark:border-red-900/30">
            <AlertCircle className="w-10 h-10" />
            <p className="font-bold">Failed to load comparison</p>
          </div>
        ) : !data || data.rows.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3 bg-white dark:bg-card rounded-xl border shadow-sm">
            <Info className="w-10 h-10 opacity-50" />
            <p className="font-medium">No data available for the selected products and filters.</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-card rounded-xl border border-border shadow-sm flex-1 flex flex-col min-h-0">
             <div className="overflow-auto flex-1">
               <table className="w-full table-fixed text-xs text-left border-collapse">
                 <thead className="bg-slate-100/80 dark:bg-muted/50 text-slate-600 dark:text-muted-foreground sticky top-0 z-10 shadow-sm backdrop-blur-sm">
                   <tr>
                      <th className="px-1.5 py-2 font-bold w-8 border-b"></th>
                      <th className="px-2.5 py-2 font-bold w-[34%] border-b uppercase tracking-wider text-[10px]">Product Info</th>
                      <th className="px-2.5 py-2 font-bold text-right w-[22%] border-b bg-indigo-50/80 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-300 uppercase tracking-wider text-[10px]">Prayag MRP</th>
                     {data.competitors.map(comp => (
                        <th key={comp} className="px-2.5 py-2 font-bold text-right w-[21%] border-b uppercase tracking-wider text-[10px]">
                          <span>{comp}</span>
                          {String(comp) === "Ashirvad" && (
                            <span className="mt-1 ml-auto flex w-fit items-center gap-1 rounded border border-amber-200 bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold normal-case tracking-normal text-amber-800">
                              <AlertCircle className="h-2.5 w-2.5 shrink-0" />
                              01 Mar 2025 · 18+ months old
                            </span>
                          )}
                        </th>
                     ))}
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-border/60">
                   {data.rows.map(row => (
                     <tr key={row.itemCode} className="hover:bg-slate-50 dark:hover:bg-muted/30 transition-colors group">
                        <td className="px-1.5 py-3 align-top w-8">
                          <button
                           onClick={() => removeCode(row.itemCode)}
                             className="text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1 rounded-md hover:bg-destructive/10 mt-0.5"
                           title="Remove from comparison"
                            aria-label={`Remove ${row.itemCode} from comparison`}
                         >
                            <Trash2 className="w-3.5 h-3.5" />
                         </button>
                       </td>
                        <td className="px-2.5 py-3 align-top break-words">
                          <div className="font-mono text-xs font-black text-primary mb-0.5">{row.itemCode}</div>
                          <div className="font-bold text-slate-900 dark:text-foreground leading-snug mb-0.5">{row.productName}</div>
                          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide leading-tight">{row.division} • {row.category}</div>
                       </td>
                        <td className="px-2.5 py-3 align-top text-right bg-indigo-50/30 dark:bg-indigo-950/10">
                         {row.prayag.price != null ? (
                           <>
                              <div className="font-black text-lg text-indigo-950 dark:text-indigo-100">{formatMoney(row.prayag.price)}</div>
                               <div className="text-[10px] font-medium text-indigo-700/70 dark:text-indigo-300/70 mt-0.5">from {formatPriceDate(row.prayag.effectiveDate)}</div>
                           </>
                         ) : (
                           <div className="text-muted-foreground font-medium italic text-xs mt-1">Pending</div>
                         )}
                         {row.prayag.upcomingPrice != null && (
                            <div className="mt-2 p-1.5 bg-amber-50 dark:bg-amber-900/30 rounded border border-amber-200/60 dark:border-amber-800 text-[10px] text-amber-900 dark:text-amber-100 text-right inline-block shadow-sm max-w-full">
                              <div className="font-black flex flex-wrap items-center justify-end gap-1">
                                <span>{formatMoney(row.prayag.upcomingPrice)}</span>
                                <span className="text-[8px] uppercase tracking-wide opacity-70 bg-amber-200 dark:bg-amber-800 px-1 rounded-sm">Upcoming</span>
                             </div>
                               <div className="opacity-80 mt-0.5 font-medium">from {formatPriceDate(row.prayag.upcomingEffectiveDate)}</div>
                           </div>
                         )}
                       </td>
                       {data.competitors.map(compName => {
                         const compData = row.competitors.find(c => c.competitor === compName);
                         if (!compData || compData.price == null) {
                            return <td key={compName} className="px-2.5 py-3 align-top text-right text-muted-foreground italic text-[10px] font-medium break-words">No data matched</td>
                         }
                         const isCheaper = compData.cheaperSide === compName;
                         const isPrayagCheaper = compData.cheaperSide === "Prayag";
                         
                         return (
                            <td key={compName} className="px-2.5 py-3 align-top text-right break-words">
                              <div className="font-bold text-base text-slate-900 dark:text-foreground">{formatMoney(compData.price)}</div>
                             
                             {compData.differencePct != null && (
                               <div className={cn(
                                  "text-[10px] font-bold mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded max-w-full",
                                 isCheaper ? "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300" : 
                                 isPrayagCheaper ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" : 
                                 "bg-slate-100 text-slate-600 dark:bg-muted dark:text-muted-foreground"
                               )}>
                                 {isCheaper ? (
                                    <><TrendingDown className="w-3 h-3 shrink-0"/> <span className="break-words">{Math.abs(compData.differencePct).toFixed(1)}% below Prayag</span></>
                                 ) : isPrayagCheaper ? (
                                    <><TrendingUp className="w-3 h-3 shrink-0"/> <span className="break-words">{Math.abs(compData.differencePct).toFixed(1)}% above Prayag</span></>
                                 ) : (
                                    <><Minus className="w-3 h-3 shrink-0"/> Parity</>
                                 )}
                               </div>
                             )}
                             
                               <div className="text-[10px] font-medium text-muted-foreground mt-1">from {formatPriceDate(compData.effectiveDate)}</div>
                             
                             {compData.upcomingPrice != null && (
                                <div className="mt-2 p-1.5 bg-slate-50 dark:bg-muted/50 rounded border border-border/60 text-[10px] text-right inline-block shadow-sm max-w-full">
                                  <div className="font-bold text-foreground flex flex-wrap items-center justify-end gap-1">
                                    <span>{formatMoney(compData.upcomingPrice)}</span>
                                    <span className="text-[8px] uppercase tracking-wide text-muted-foreground bg-slate-200 dark:bg-muted px-1 rounded-sm">Upcoming</span>
                                 </div>
                                   <div className="text-muted-foreground mt-0.5 font-medium">from {formatPriceDate(compData.upcomingEffectiveDate)}</div>
                               </div>
                             )}
                              <UpcomingGapDetails
                                compact
                                effectiveDate={compData.upcomingGapDate}
                                prayagPrice={compData.upcomingGapPrayagPrice}
                                competitorPrice={compData.upcomingGapCompetitorPrice}
                                gapPct={compData.upcomingGapPct}
                                direction={compData.upcomingGapDirection}
                                isReversal={compData.upcomingGapIsReversal}
                                className="ml-auto max-w-[240px] text-left"
                              />
                           </td>
                         )
                       })}
                     </tr>
                   ))}
                 </tbody>
               </table>
             </div>
             
              <div className="bg-slate-50 dark:bg-muted/30 px-3 py-2 border-t border-border/60 text-[10px] font-medium text-muted-foreground flex flex-wrap items-center justify-between gap-x-3 gap-y-1 shrink-0">
                 <div>Confirmed matches only · Comparable MRP basis</div>
                 <div>Resolved as of <span className="font-bold text-foreground">{formatPriceDate(data.asOfDate)}</span></div>
             </div>
          </div>
        )}
      </div>
    </div>
  );
}