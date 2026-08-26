import { useSearch, useLocation, Link } from "wouter";
import { useGetPriceFinderComparison, getExportPriceFinderComparisonUrl } from "@workspace/api-client-react";
import { ChevronLeft, Download, Info, AlertCircle, TrendingDown, TrendingUp, Minus, Search, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useSelection } from "@/lib/useSelection";
import { formatPriceDate } from "@/components/price-window";

const COMPETITORS = ["Sparsh Pearl", "Vectus"] as const;

export default function ComparisonPage() {
  const searchString = useSearch();
  const [, setLocation] = useLocation();
  const { codes, removeCode } = useSelection();
  const params = new URLSearchParams(searchString);
  const rawCompetitors = params.getAll("competitor");
  const activeCompetitors = rawCompetitors.length > 0 ? rawCompetitors : ["Sparsh Pearl"];
  const asOf = params.get("asOf") || "";

  const updateFilters = (newCompetitors: string[], newAsOf: string) => {
    const p = new URLSearchParams();
    codes.forEach(c => p.append("code", c));
    newCompetitors.forEach(c => p.append("competitor", c));
    if (newAsOf) p.append("asOf", newAsOf);
    setLocation(`/comparison?${p.toString()}`);
  };

  const handleCompetitorToggle = (comp: string) => {
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
      competitor: activeCompetitors as ("Sparsh Pearl" | "Vectus")[], 
      asOf: asOf || undefined 
    },
    {
      query: {
        queryKey: ["price-finder-comparison", codes, activeCompetitors, asOf],
        enabled: codes.length > 0,
      }
    }
  );

  const exportUrl = getExportPriceFinderComparisonUrl({
    code: codes,
    competitor: activeCompetitors as ("Sparsh Pearl" | "Vectus")[],
    asOf: asOf || undefined
  });

  if (codes.length === 0) {
    return (
      <div className="max-w-4xl mx-auto p-8 text-center mt-20">
        <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
          <Search className="w-8 h-8 text-muted-foreground" />
        </div>
        <h1 className="text-2xl font-bold mb-2">No Products Selected</h1>
        <p className="text-muted-foreground mb-6">Select products from the Price Finder to compare them.</p>
        <Link href="/" className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 bg-primary text-primary-foreground hover:bg-primary/90 h-10 py-2 px-4 shadow-sm">
          Go to Price Finder
        </Link>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      <div className="bg-gradient-to-r from-indigo-950 via-slate-900 to-slate-900 text-white shrink-0">
        <div className="max-w-[1600px] mx-auto p-4 md:px-6 md:py-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-indigo-300 mb-1.5">
              <Link href={`/?${new URLSearchParams(codes.map(c => ['code', c])).toString()}`} className="hover:text-white transition-colors flex items-center gap-1 text-sm font-medium">
                <ChevronLeft className="w-4 h-4" /> Back to Search
              </Link>
            </div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight text-white">Product Comparison</h1>
            <p className="text-indigo-200 mt-1 text-sm font-medium">
              Comparing {codes.length} selected product{codes.length > 1 ? "s" : ""}
            </p>
          </div>
          
          <div className="flex flex-wrap items-center gap-5 bg-slate-800/80 p-3 rounded-xl border border-white/10 shadow-sm">
            <div className="flex items-center gap-4 border-r border-white/10 pr-5">
              {COMPETITORS.map(comp => (
                <label key={comp} className="flex items-center gap-2 cursor-pointer group text-sm font-semibold text-slate-200 hover:text-white transition-colors">
                  <Checkbox 
                    checked={activeCompetitors.includes(comp)}
                    onCheckedChange={() => handleCompetitorToggle(comp)}
                    className="border-indigo-400/50 data-[state=checked]:bg-indigo-500 data-[state=checked]:border-indigo-500 rounded"
                  />
                  {comp}
                </label>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <Label htmlFor="asOf" className="text-sm font-semibold text-slate-300">As of Date</Label>
              <Input 
                id="asOf"
                type="date"
                value={asOf}
                onChange={e => updateFilters(activeCompetitors, e.target.value)}
                className="h-9 w-[140px] bg-slate-950/50 border-white/10 text-white focus-visible:ring-indigo-500 font-medium"
              />
            </div>
            <a 
              href={exportUrl}
              download
              className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-5 h-9 rounded-lg text-sm font-bold transition-colors shadow ml-auto lg:ml-2"
            >
              <Download className="w-4 h-4" /> Export Excel
            </a>
          </div>
        </div>
      </div>

      <div className="flex-1 w-full mx-auto p-4 md:p-6 overflow-hidden flex flex-col bg-slate-50 dark:bg-background">
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground animate-pulse font-medium">
            <Search className="w-5 h-5 mr-2 opacity-50" /> Loading comparison data...
          </div>
        ) : isError ? (
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
               <table className="w-full text-sm text-left border-collapse">
                 <thead className="bg-slate-100/80 dark:bg-muted/50 text-slate-600 dark:text-muted-foreground sticky top-0 z-10 shadow-sm backdrop-blur-sm">
                   <tr>
                     <th className="px-4 py-3.5 font-bold w-12 border-b"></th>
                     <th className="px-4 py-3.5 font-bold min-w-[240px] border-b uppercase tracking-wider text-[11px]">Product Info</th>
                     <th className="px-6 py-3.5 font-bold text-right min-w-[160px] border-b bg-indigo-50/80 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-300 uppercase tracking-wider text-[11px]">Prayag MRP</th>
                     {data.competitors.map(comp => (
                       <th key={comp} className="px-6 py-3.5 font-bold text-right min-w-[180px] border-b uppercase tracking-wider text-[11px]">{comp}</th>
                     ))}
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-border/60">
                   {data.rows.map(row => (
                     <tr key={row.itemCode} className="hover:bg-slate-50 dark:hover:bg-muted/30 transition-colors group">
                       <td className="px-4 py-5 align-top w-12">
                          <button
                           onClick={() => removeCode(row.itemCode)}
                            className="text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1.5 rounded-md hover:bg-destructive/10 mt-0.5"
                           title="Remove from comparison"
                            aria-label={`Remove ${row.itemCode} from comparison`}
                         >
                           <Trash2 className="w-4 h-4" />
                         </button>
                       </td>
                       <td className="px-4 py-5 align-top">
                         <div className="font-mono text-sm font-black text-primary mb-1.5">{row.itemCode}</div>
                         <div className="font-bold text-slate-900 dark:text-foreground leading-snug mb-1">{row.productName}</div>
                         <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{row.division} • {row.category}</div>
                       </td>
                       <td className="px-6 py-5 align-top text-right bg-indigo-50/30 dark:bg-indigo-950/10">
                         {row.prayag.price != null ? (
                           <>
                             <div className="font-black text-xl text-indigo-950 dark:text-indigo-100">₹{row.prayag.price.toFixed(2)}</div>
                              <div className="text-[11px] font-medium text-indigo-700/70 dark:text-indigo-300/70 mt-1">from {formatPriceDate(row.prayag.effectiveDate)}</div>
                           </>
                         ) : (
                           <div className="text-muted-foreground font-medium italic text-xs mt-1">Pending</div>
                         )}
                         {row.prayag.upcomingPrice != null && (
                           <div className="mt-4 p-2 bg-amber-50 dark:bg-amber-900/30 rounded border border-amber-200/60 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-100 text-right inline-block shadow-sm">
                             <div className="font-black flex items-center justify-end gap-1.5">
                               <span className="text-sm">₹{row.prayag.upcomingPrice.toFixed(2)}</span>
                               <span className="text-[9px] uppercase tracking-wider opacity-70 bg-amber-200 dark:bg-amber-800 px-1 rounded-sm">Upcoming</span>
                             </div>
                              <div className="opacity-80 mt-1 font-medium">from {formatPriceDate(row.prayag.upcomingEffectiveDate)}</div>
                           </div>
                         )}
                       </td>
                       {data.competitors.map(compName => {
                         const compData = row.competitors.find(c => c.competitor === compName);
                         if (!compData || compData.price == null) {
                           return <td key={compName} className="px-6 py-5 align-top text-right text-muted-foreground italic text-xs font-medium">No data matched</td>
                         }
                         const isCheaper = compData.cheaperSide === compName;
                         const isPrayagCheaper = compData.cheaperSide === "Prayag";
                         
                         return (
                           <td key={compName} className="px-6 py-5 align-top text-right">
                             <div className="font-bold text-lg text-slate-900 dark:text-foreground">₹{compData.price.toFixed(2)}</div>
                             
                             {compData.differencePct != null && (
                               <div className={cn(
                                 "text-[11px] font-bold mt-1.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded",
                                 isCheaper ? "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300" : 
                                 isPrayagCheaper ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" : 
                                 "bg-slate-100 text-slate-600 dark:bg-muted dark:text-muted-foreground"
                               )}>
                                 {isCheaper ? (
                                   <><TrendingDown className="w-3.5 h-3.5"/> {Math.abs(compData.differencePct).toFixed(1)}% below Prayag</>
                                 ) : isPrayagCheaper ? (
                                   <><TrendingUp className="w-3.5 h-3.5"/> {Math.abs(compData.differencePct).toFixed(1)}% above Prayag</>
                                 ) : (
                                   <><Minus className="w-3.5 h-3.5"/> Parity</>
                                 )}
                               </div>
                             )}
                             
                              <div className="text-[11px] font-medium text-muted-foreground mt-2">from {formatPriceDate(compData.effectiveDate)}</div>
                             
                             {compData.upcomingPrice != null && (
                               <div className="mt-4 p-2 bg-slate-50 dark:bg-muted/50 rounded border border-border/60 text-xs text-right inline-block shadow-sm">
                                 <div className="font-bold text-foreground flex items-center justify-end gap-1.5">
                                   <span className="text-sm">₹{compData.upcomingPrice.toFixed(2)}</span>
                                   <span className="text-[9px] uppercase tracking-wider text-muted-foreground bg-slate-200 dark:bg-muted px-1 rounded-sm">Upcoming</span>
                                 </div>
                                  <div className="text-muted-foreground mt-1 font-medium">from {formatPriceDate(compData.upcomingEffectiveDate)}</div>
                               </div>
                             )}
                           </td>
                         )
                       })}
                     </tr>
                   ))}
                 </tbody>
               </table>
             </div>
             
             <div className="bg-slate-50 dark:bg-muted/30 p-4 border-t border-border/60 text-xs font-medium text-muted-foreground flex items-center justify-between shrink-0">
                <div>Only confirmed product matches are shown. Prices are normalized to a comparable MRP basis.</div>
                <div>Resolved as of <span className="font-bold text-foreground">{formatPriceDate(data.asOfDate)}</span></div>
             </div>
          </div>
        )}
      </div>
    </div>
  );
}