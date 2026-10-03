import { formatMoney } from "@workspace/formatting";
import React, { useState, useMemo } from "react";
import { useCompareMrpGeneratorRuns, getCompareMrpGeneratorRunsQueryKey, useListMrpGeneratorRuns, MrpGeneratorComparison } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRightLeft, Plus, Trash2, ChevronDown, Check, X, ChevronRight, Filter } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type FilterState = {
  disagreementsOnly: boolean;
  oneHasSuggestion: boolean;
  minDifference: number | "";
};

export default function MrpGeneratorCompare() {
  const [runIdsInput, setRunIdsInput] = useState<string[]>(["", ""]);
  const [submittedIds, setSubmittedIds] = useState<number[] | null>(null);

  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<FilterState>({
    disagreementsOnly: true,
    oneHasSuggestion: false,
    minDifference: "",
  });

  const { data: runsData } = useListMrpGeneratorRuns({ limit: 10 });
  const recentRuns = runsData?.runs || [];

  const { data, isLoading, error } = useCompareMrpGeneratorRuns(
    { runIds: submittedIds as number[] },
    { query: { enabled: !!submittedIds && submittedIds.length >= 2, queryKey: submittedIds ? getCompareMrpGeneratorRunsQueryKey({ runIds: submittedIds }) : ["compare-mrp-runs", "none"] } }
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = runIdsInput.map(id => parseInt(id)).filter(id => !isNaN(id));
    if (parsed.length >= 2) {
      setSubmittedIds(parsed);
      setExpandedRows(new Set());
    }
  };

  const addRunInput = () => {
    setRunIdsInput(prev => [...prev, ""]);
  };

  const removeRunInput = (index: number) => {
    setRunIdsInput(prev => prev.filter((_, i) => i !== index));
  };

  const updateRunInput = (index: number, value: string) => {
    setRunIdsInput(prev => prev.map((item, i) => i === index ? value : item));
  };

  const toggleRow = (itemCode: string) => {
    const next = new Set(expandedRows);
    if (next.has(itemCode)) next.delete(itemCode);
    else next.add(itemCode);
    setExpandedRows(next);
  };

  // Ensure data exists before trying to access it
  const comparisonData = data as MrpGeneratorComparison | undefined;

  const products = comparisonData?.products || [];

  const filteredProducts = useMemo(() => {
    return products.filter((p: any) => {
      if (filters.disagreementsOnly) {
        if (p.category === "agree") return false;
      }

      const values = submittedIds ? submittedIds.map(id => p.values[String(id)]?.suggestedMrp) : [];
      if (filters.oneHasSuggestion) {
        if (p.category === "one_sided" || p.category === "historical_only" || p.category === "competitive_only") {
          // Handled by category
        } else {
          const hasSuggestion = values.some(v => v != null);
          const someMissing = values.some(v => v == null);
          if (!(hasSuggestion && someMissing)) return false;
        }
      }

      if (filters.minDifference !== "") {
        const minDiff = Number(filters.minDifference);
        if (!isNaN(minDiff) && minDiff > 0) {
          const validValues = values.filter((v): v is number => v != null);
          if (validValues.length < 2) return false;
          const max = Math.max(...validValues);
          const min = Math.min(...validValues);
          if ((max - min) < minDiff) return false;
        }
      }

      return true;
    });
  }, [products, filters, submittedIds]);

  return (
    <div className="flex flex-col min-h-full bg-muted/20">
      <div className="border-b bg-card px-4 py-3 sm:px-6">
        <h1 className="text-lg font-semibold text-foreground">Compare Scenarios</h1>
        <p className="text-sm text-muted-foreground">Compare the results of multiple generator runs side-by-side.</p>
      </div>

      <div className="p-4 sm:p-6 max-w-[1600px] mx-auto w-full space-y-6">
        <div className="bg-card border p-4 sm:p-5 rounded-lg shadow-sm">
          <form onSubmit={handleSubmit} className="flex flex-col space-y-4">
            <div className="flex flex-wrap items-end gap-4">
              {runIdsInput.map((val, idx) => (
                <div key={idx} className="flex items-end gap-2">
                  <div className="w-32 space-y-1">
                    <Label>Run ID {idx + 1}</Label>
                    <Input required type="number" value={val} onChange={e => updateRunInput(idx, e.target.value)} placeholder="e.g. 12" />
                  </div>
                  {runIdsInput.length > 2 && (
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeRunInput(idx)} className="mb-0.5" title="Remove">
                      <Trash2 className="w-4 h-4 text-muted-foreground" />
                    </Button>
                  )}
                  {idx < runIdsInput.length - 1 && (
                    <div className="hidden md:flex shrink-0 mb-2 px-1 text-muted-foreground">
                      <ArrowRightLeft className="w-4 h-4" />
                    </div>
                  )}
                </div>
              ))}

              <Button type="button" variant="outline" onClick={addRunInput} className="mb-0.5">
                <Plus className="w-4 h-4 mr-2" /> Add Run
              </Button>
              <Button type="submit" className="mb-0.5 ml-auto">Compare</Button>
            </div>
          </form>

          {recentRuns.length > 0 && (
            <div className="mt-4 pt-4 border-t flex flex-wrap items-center gap-3 text-sm">
              <span className="text-muted-foreground">Recent:</span>
              {recentRuns.slice(0, 5).map(r => (
                <button
                  key={r.id}
                  type="button"
                  className="px-2 py-1 bg-muted rounded border hover:border-primary transition-colors text-xs"
                  onClick={() => {
                    // find first empty slot
                    const idx = runIdsInput.findIndex(v => v === "");
                    if (idx !== -1) {
                      updateRunInput(idx, r.id.toString());
                    } else {
                      setRunIdsInput(prev => [...prev, r.id.toString()]);
                    }
                  }}
                >
                  #{r.id} ({r.runType === "matching" ? "Matching" : r.scenarioName || "Run"})
                </button>
              ))}
            </div>
          )}
        </div>

        {submittedIds && submittedIds.length >= 2 && (
          <div className="space-y-4">
            {/* Runs Summary */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {comparisonData?.runs?.map((r: any) => (
                <div key={r.runId} className="bg-card border rounded-lg p-4 shadow-sm text-sm">
                  <h3 className="font-semibold text-foreground border-b pb-2 mb-2">Run #{r.runId} <span className="font-normal text-muted-foreground ml-1 capitalize">({r.runType || r.modelKind})</span></h3>
                  <div className="flex flex-col gap-1 text-muted-foreground">
                    <div className="flex justify-between">
                      <span>Evaluated:</span>
                      <strong className="text-foreground">{r.summary?.evaluated ?? r.summary?.total ?? 0}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span>Would Change:</span>
                      <strong className="text-foreground text-emerald-600">{r.summary?.wouldChange ?? r.summary?.suggested ?? 0}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span>Median Change:</span>
                      <strong className="text-foreground">{r.summary?.medianIncreasePercent != null ? `+${r.summary.medianIncreasePercent}%` : "-"} / {r.summary?.medianDecreasePercent != null ? `${r.summary.medianDecreasePercent}%` : "-"}</strong>
                    </div>
                    {r.summary?.portfolio?.deltaPoints != null && (
                      <div className="flex justify-between">
                        <span>Total Value Movement:</span>
                        <strong className="text-foreground">{r.summary.portfolio.deltaPoints > 0 ? "+" : ""}{r.summary.portfolio.deltaPoints.toFixed(1)} pts</strong>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {comparisonData?.categoryCounts && (
                <div className="bg-card border rounded-lg p-4 shadow-sm text-sm">
                  <h3 className="font-semibold text-foreground border-b pb-2 mb-2">Comparison Overview</h3>
                  <div className="flex flex-col gap-1 text-muted-foreground">
                    {Object.entries(comparisonData.categoryCounts).map(([cat, count]) => (
                      count > 0 && (
                        <div key={cat} className="flex justify-between">
                          <span className="capitalize">{cat.replace(/_/g, ' ')}:</span>
                          <strong className="text-foreground">{count as number}</strong>
                        </div>
                      )
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Collective Margin Metrics */}
            {(comparisonData?.runs)?.some((r: any) => r.collectiveMargin) && (
              <div className="bg-card border rounded-lg p-4 shadow-sm space-y-4">
                <h3 className="font-semibold text-foreground border-b pb-2">Collective Margin Projections</h3>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {(comparisonData.runs).map((r: any) => {
                    if (!r.collectiveMargin) return null;
                    const cm = r.collectiveMargin;
                    return (
                      <div key={r.runId} className="space-y-3 bg-muted/20 p-3 border rounded-md text-sm">
                        <div className="flex items-center justify-between border-b pb-2">
                          <h4 className="font-medium">
                            Run #{r.runId}
                            <span className="ml-2 text-xs text-muted-foreground bg-background px-1.5 py-0.5 rounded border capitalize">{r.runType || r.modelKind}</span>
                          </h4>
                          {cm.assumptions && cm.assumptions.length > 0 && (
                            <div className="text-[10px] text-muted-foreground bg-background px-1.5 py-0.5 rounded border">
                              {cm.assumptions.join(" • ")}
                            </div>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                          <span className="text-muted-foreground">Current Margin:</span>
                          <span className="text-right font-medium">{cm.current != null ? (cm.current * 100).toFixed(1) + '%' : "N/A"}</span>

                          <span className="text-muted-foreground">Projected Margin:</span>
                          <span className="text-right font-medium text-emerald-700">{cm.projected != null ? (cm.projected * 100).toFixed(1) + '%' : "N/A"}</span>

                          <span className="text-muted-foreground">Delta:</span>
                          <span className="text-right font-bold">{cm.deltaPoints != null ? (cm.deltaPoints > 0 ? "+" : "") + cm.deltaPoints.toFixed(1) + " pts" : "-"}</span>

                          <span className="text-muted-foreground">Coverage:</span>
                          <span className="text-right">{cm.coverage?.share != null ? (cm.coverage.share * 100).toFixed(1) + '%' : "0%"} ({cm.includedCount} items)</span>

                          <span className="text-muted-foreground">Value at Risk:</span>
                          <span className="text-right text-amber-700">{formatMoney(cm.valueAtRisk?.value)}</span>

                          <span className="text-muted-foreground">Missing Data:</span>
                          <span className="text-right text-destructive">{cm.excludedCount} items</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Filters */}
            <div className="bg-card border p-3 rounded-lg shadow-sm flex flex-wrap items-center gap-4 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground font-medium">
                <Filter className="w-4 h-4" /> Filters:
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={filters.disagreementsOnly} onChange={e => setFilters(f => ({ ...f, disagreementsOnly: e.target.checked }))} className="rounded border-input" />
                Disagreements Only
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={filters.oneHasSuggestion} onChange={e => setFilters(f => ({ ...f, oneHasSuggestion: e.target.checked }))} className="rounded border-input" />
                At Least One Suggestion
              </label>
              <div className="flex items-center gap-2">
                <Label className="text-sm font-normal">Min absolute diff (₹):</Label>
                <Input type="number" min="0" value={filters.minDifference} onChange={e => setFilters(f => ({ ...f, minDifference: e.target.value ? Number(e.target.value) : "" }))} className="w-24 h-8 text-sm" />
              </div>
            </div>

            {/* Comparison Table */}
            <div className="bg-card border rounded-lg overflow-hidden shadow-sm">
              <div className="flex overflow-x-auto">
                <div className="min-w-max w-full">
                  <div className="grid border-b bg-muted/40 text-xs font-semibold text-muted-foreground uppercase tracking-wider p-3"
                    style={{ gridTemplateColumns: `minmax(200px, 1.5fr) repeat(${submittedIds.length}, minmax(140px, 1fr)) 60px` }}
                  >
                    <div>Product</div>
                    {submittedIds.map(id => (
                      <div key={id} className="text-right">Run #{id}</div>
                    ))}
                    <div></div>
                  </div>

                  <div className="divide-y">
                    {isLoading ? (
                      <div className="p-4 space-y-3">
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-10 w-full" />
                      </div>
                    ) : error ? (
                      <div className="p-8 text-center text-destructive">Failed to load comparison data.</div>
                    ) : filteredProducts.length === 0 ? (
                      <div className="p-8 text-center text-muted-foreground">No differences found matching your filters.</div>
                    ) : (
                      filteredProducts.map((p: any, idx: number) => {
                        const expanded = expandedRows.has(p.itemCode);
                        const firstVal = submittedIds.map(id => p.values[String(id)]).find(v => v);
                        const productName = firstVal?.productName || "No product name";

                        return (
                          <div key={p.itemCode || idx} className={cn("transition-colors hover:bg-muted/10", expanded && "bg-muted/10")}>
                            <div className="grid p-3 text-sm items-center" style={{ gridTemplateColumns: `minmax(200px, 1.5fr) repeat(${submittedIds.length}, minmax(140px, 1fr)) 60px` }}>
                              <div className="min-w-0 pr-4">
                                <div className="font-medium text-foreground truncate">{p.itemCode}</div>
                                <div className="text-xs text-muted-foreground truncate">{productName}</div>
                              </div>

                              {submittedIds.map((id, i) => {
                                const val = p.values[String(id)];
                                const isDiff = p.comparisonChanged; // we can highlight differences

                                return (
                                  <div key={id} className={cn("text-right px-2", isDiff ? "font-medium" : "")}>
                                    {val == null ? "Not in scope" : val.suggestedMrp != null ? `${formatMoney(val.suggestedMrp)}` : val.status}
                                    {val?.action && (
                                      <div className="text-[10px] text-muted-foreground mt-1">
                                        {val.action} {val.band && `• Bnd ${val.band}`}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}

                              <button onClick={() => toggleRow(p.itemCode)} className="ml-auto p-1 rounded hover:bg-accent flex justify-center text-muted-foreground">
                                <ChevronDown className={cn("w-4 h-4 transition-transform", expanded && "rotate-180")} />
                              </button>
                            </div>

                            {/* Expanded Details */}
                            {expanded && (
                              <div className="px-3 pb-4 pt-1 space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm mt-2">
                                  {submittedIds.map((id) => {
                                    const val = p.values[String(id)];
                                    if (!val) return null;

                                    return (
                                      <div key={id} className="bg-background border rounded p-3 space-y-2">
                                        <h4 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground border-b pb-1">Run #{id} Evidence</h4>
                                        <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
                                          <span className="text-muted-foreground">Status:</span>
                                          <span className="text-right font-medium">{val.status}</span>
                                          {val.currentMrp != null && (
                                            <>
                                              <span className="text-muted-foreground">Current MRP:</span>
                                              <span className="text-right">{formatMoney(val.currentMrp)}</span>
                                            </>
                                          )}
                                        </div>

                                        {val.historicalEvidence ? (
                                          <div className="mt-2 space-y-1 bg-muted/20 p-2 border rounded text-xs">
                                            <div className="font-semibold text-[10px] uppercase text-muted-foreground mb-1">Historical Range</div>
                                            <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                                              <span className="text-muted-foreground">Range:</span>
                                              <span className="text-right font-medium">{val.historicalEvidence.series || "None"}</span>
                                              <span className="text-muted-foreground">Reason/Status:</span>
                                              <span className="text-right">{val.historicalEvidence.status || val.reason || "-"}</span>
                                              {val.reason && (
                                                <>
                                                  <span className="text-muted-foreground">Product Reason:</span>
                                                  <span className="text-right">{val.reason}</span>
                                                </>
                                              )}
                                            </div>
                                          </div>
                                        ) : (
                                          <div className="space-y-1 mt-2">
                                            <div className="font-semibold text-[10px] uppercase text-muted-foreground mb-1">Deciding Rule</div>
                                            {val.decisionSentence ? (
                                              <div className="text-xs">{val.decisionSentence}</div>
                                            ) : val.trace?.filter((t: any) => t.outcome === "fired").map((t: any, i: number) => (
                                              <div key={i} className="text-xs bg-primary/5 border border-primary/20 p-1.5 rounded">
                                                <span className="font-medium mr-1">{t.ruleType}:</span>
                                                {t.reason}
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}