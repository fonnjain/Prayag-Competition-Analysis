import React, { useState } from "react";
import { useRoute } from "wouter";
import { useGetMrpGeneratorRun, useHandoffMrpGeneratorRun, getGetMrpGeneratorRunQueryKey, MrpGeneratorTrace, MrpGeneratorCompetitorValue, MrpGeneratorFreshnessCompetitor } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronRight, ArrowRight, Zap, ChevronDown, Check, X, AlertTriangle, Lock, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDisplayDate } from "@/lib/date-format";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";

export default function MrpGeneratorRun() {
  const [, params] = useRoute("/mrp-generator/runs/:id");
  const runId = Number(params?.id);
  const { data, isLoading, error } = useGetMrpGeneratorRun(runId, { query: { enabled: !!runId, queryKey: getGetMrpGeneratorRunQueryKey(runId) } });
  const handoffMutation = useHandoffMrpGeneratorRun();
  const { toast } = useToast();

  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [filterBand, setFilterBand] = useState<string>("_all");
  const [filterAction, setFilterAction] = useState<string>("_all");
  const [filterPosition, setFilterPosition] = useState<string>("_all");
  const [filterEscalation, setFilterEscalation] = useState<string>("_all");

  const isError403 = (err: any) => err && typeof err === 'object' && 'status' in err && err.status === 403;

  if (isLoading) return <div className="p-8 space-y-4"><Skeleton className="h-10 w-1/4" /><Skeleton className="h-40 w-full" /><Skeleton className="h-96 w-full" /></div>;
  if (isError403(error)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center space-y-4">
        <div className="w-12 h-12 bg-destructive/10 rounded-full flex items-center justify-center">
          <Lock className="w-6 h-6 text-destructive" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">Access Denied</h2>
          <p className="text-muted-foreground mt-1 max-w-md mx-auto">
            You do not have permission to access the MRP Generator.
          </p>
        </div>
      </div>
    );
  }
  if (error || !data) return <div className="p-8 text-destructive">Error loading run details.</div>;

  const { run, scenario, results } = data;
  const summary = run.summary as any;
  const freshness = run.sourceFreshness;
  const isHistorical = run.runType === "historical" || run.modelKind === "historical";
  const isMatching = run.runType === "matching";
  const historicalSnapshot = isHistorical ? (run.inputSnapshot as any) : null;
  const historicalSeries = historicalSnapshot?.seriesAnalyses || [];

  const toggleRow = (itemCode: string) => {
    const next = new Set(expandedRows);
    if (next.has(itemCode)) next.delete(itemCode);
    else next.add(itemCode);
    setExpandedRows(next);
  };

  const toggleSelect = (itemCode: string) => {
    const next = new Set(selectedRows);
    if (next.has(itemCode)) next.delete(itemCode);
    else next.add(itemCode);
    setSelectedRows(next);
  };

  const selectAllEligible = () => {
    if (selectedRows.size > 0) {
      setSelectedRows(new Set());
    } else {
      const eligible = results.filter((r) => r.status === "suggested").map((r) => r.itemCode);
      setSelectedRows(new Set(eligible));
    }
  };

  const filteredResults = results.filter((r) => {
    if (search && !r.itemCode.toLowerCase().includes(search.toLowerCase()) && !(r.productName || "").toLowerCase().includes(search.toLowerCase())) return false;
    if (filterBand !== "_all" && r.band !== filterBand) return false;
    if (filterAction !== "_all" && r.action !== filterAction) return false;
    if (filterPosition !== "_all" && r.position !== filterPosition) return false;
    if (filterEscalation !== "_all") {
      const isEscalated = r.escalation ? "yes" : "no";
      if (filterEscalation !== isEscalated) return false;
    }
    return true;
  });

  const getErrorMessage = (err: any) => {
    if (err && typeof err === 'object' && 'data' in err && err.data && typeof err.data === 'object' && 'error' in err.data) {
      return (err.data as any).error;
    }
    return err?.message || "Unknown error";
  };

  const handleHandoff = () => {
    if (selectedRows.size === 0) return;
    const itemCodes = Array.from(selectedRows);

    handoffMutation.mutate({ runId, data: { itemCodes } }, {
      onSuccess: (res) => {
        const url = `/product-db/mrp-revisions?batchId=${res.batchId}`;
        toast({ title: "Handoff Successful", description: "Created revision preview." });
        window.location.href = url;
      },
      onError: (err) => {
        toast({ title: "Handoff Failed", description: getErrorMessage(err), variant: "destructive" });
      }
    });
  };

  const exportCsv = () => {
    const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const header = [
      "item_code", "product", "division", "category", "current_mrp", "current_date",
      "suggested_mrp", "change_percent", "status", "binding_constraints", "exclusions",
      "competitor_evidence", "rule_trace", "sales_evidence", "margin_evidence", "warnings",
      "p011_band", "p011_action", "p011_position", "p011_gap_percent",
      "p011_selected_competitor", "p011_competitor_mode", "p011_competitive_target",
      "p011_escalation", "p011_escalation_reason",
      "p011_fy_sales", "p011_sales_qty", "p011_sales_tier",
      "p011_margin_floor_category", "p011_margin_floor_percent", "p011_margin_floor_minimum"
    ];
    const rows = results.map((result) => [
      result.itemCode,
      result.productName,
      result.division,
      result.category,
      result.currentMrp,
      result.currentDate,
      result.suggestedMrp,
      result.changePercent,
      result.status,
      result.bindingConstraints?.join(" | ") || result.bindingConstraint || "",
      result.exclusions.join(" | "),
      result.competitorValues.map((competitor) =>
        `${competitor.competitor}: ${competitor.effectivePrice ?? "No data"} @ ${competitor.effectiveDate ?? "undated"} (${competitor.ageDays ?? "unknown"} days${competitor.stale ? ", stale" : ""})`,
      ).join(" | "),
      result.trace.map((trace) => `${trace.order + 1}. ${trace.ruleType} [${trace.outcome}] ${trace.reason}`).join(" | "),
      result.salesEvidence ? `Amt: ${result.salesEvidence.salesAmount}, Tier: ${result.salesEvidence.tier || "N/A"}` : "No data",
      result.marginEvidence ? `Margin: ${result.marginEvidence.grossMarginPct != null ? (result.marginEvidence.grossMarginPct * 100).toFixed(1) + '%' : "N/A"} (${result.marginEvidence.latestMonth || "N/A"})` : "No data",
      result.warnings?.join(" | ") || "",
      result.band || "",
      result.action || "",
      result.position || "",
      result.gap != null ? (result.gap * 100).toFixed(1) : "",
      result.selectedCompetitor || "",
      result.competitorMode || "",
      result.competitiveTarget ?? "",
      result.escalation ? "Yes" : "No",
      result.escalationReason || "",
      result.fySalesAmount ?? "",
      result.salesEvidence?.qty ?? "",
      result.salesEvidence?.tier || "",
      result.marginFloorEvidence?.category || "",
      result.marginFloorEvidence?.floorPercent != null ? result.marginFloorEvidence.floorPercent.toFixed(1) : "",
      result.marginFloorEvidence?.minimumMrp ?? ""
    ]);

    if (summary.portfolio) {
      rows.push([]);
      rows.push(["PORTFOLIO SUMMARY", "Current Gross Margin", "Proposed Gross Margin", "Delta Points", "Target Met", "Shortfall Points"]);
      rows.push([
        "",
        summary.portfolio.currentGrossMargin != null ? `${(summary.portfolio.currentGrossMargin * 100).toFixed(1)}%` : "",
        summary.portfolio.proposedGrossMargin != null ? `${(summary.portfolio.proposedGrossMargin * 100).toFixed(1)}%` : "",
        summary.portfolio.deltaPoints != null ? summary.portfolio.deltaPoints.toFixed(1) : "",
        summary.portfolio.targetMet ? "Yes" : "No",
        (summary.portfolio.shortfallPoints ?? 0).toFixed(1)
      ]);
      rows.push([]);
    }

    const blob = new Blob(
      [[header, ...rows].map((row) => row.map(quote).join(",")).join("\n")],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `mrp-generator-run-${run.id}-${run.asOf}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col min-h-full bg-muted/20 pb-20">
      <div className="border-b bg-card px-4 py-3 sm:px-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Run #{run.id}</h1>
          <p className="text-sm text-muted-foreground">Scenario: {scenario?.name || run.scenarioId} &middot; As of {formatDisplayDate(run.asOf)}</p>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download className="mr-2 h-4 w-4" /> Export CSV
        </Button>
      </div>

      <div className="p-4 sm:p-6 max-w-[1600px] mx-auto w-full space-y-6">
        {/* Summary Card */}
        <Card className="p-4 sm:p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">Run Summary</h2>
          {isMatching ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-muted/40 p-3 rounded-lg border border-border/50 text-center">
                <div className="text-2xl font-bold">{summary.manual || summary.total || 0}</div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Manual Actions</div>
              </div>
              <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-100 text-center">
                <div className="text-2xl font-bold text-emerald-700">{summary.suggested || 0}</div>
                <div className="text-xs text-emerald-600/80 uppercase tracking-wide">Draft Suggestions</div>
              </div>
              <div className="bg-muted/40 p-3 rounded-lg border border-border/50 text-center">
                <div className="text-2xl font-bold">{summary.noChange || 0}</div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Leaves (No Change)</div>
              </div>
              <div className="bg-muted/20 p-3 rounded-lg border border-border/50 text-center flex flex-col justify-center">
                <div className="text-sm font-medium truncate" title={summary.actor as string}>{summary.actor as string || "Unknown"}</div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide mt-1">Actor</div>
              </div>
            </div>
          ) : !isHistorical ? (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
              <div className="bg-muted/40 p-3 rounded-lg border border-border/50 text-center">
                <div className="text-2xl font-bold">{summary.policyVersion === 3 ? (summary.evaluated ?? summary.total) : summary.total || 0}</div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Evaluated</div>
              </div>
              <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-100 text-center">
                <div className="text-2xl font-bold text-emerald-700">{summary.policyVersion === 3 ? (summary.wouldChange ?? summary.suggested) : summary.suggested || 0}</div>
                <div className="text-xs text-emerald-600/80 uppercase tracking-wide">Would Change</div>
              </div>
              <div className="bg-muted/40 p-3 rounded-lg border border-border/50 text-center">
                <div className="text-2xl font-bold">{summary.noChange || 0}</div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide">No Change</div>
              </div>
              <div className="bg-red-50 p-3 rounded-lg border border-red-100 text-center">
                <div className="text-2xl font-bold text-red-700">{summary.excluded || 0}</div>
                <div className="text-xs text-red-600/80 uppercase tracking-wide">Excluded</div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
              <div className="bg-muted/40 p-3 rounded-lg border border-border/50 text-center">
                <div className="text-2xl font-bold">{historicalSeries.filter((s: any) => s.usable).length}</div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Usable Series</div>
              </div>
              <div className="bg-red-50 p-3 rounded-lg border border-red-100 text-center">
                <div className="text-2xl font-bold text-red-700">{historicalSeries.filter((s: any) => !s.usable).length}</div>
                <div className="text-xs text-red-600/80 uppercase tracking-wide">Unusable Series</div>
              </div>
              <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-100 text-center">
                <div className="text-2xl font-bold text-emerald-700">{results.filter((r) => r.historicalEvidence?.status === "DUE" || r.historicalEvidence?.status === "OVERDUE").length}</div>
                <div className="text-xs text-emerald-600/80 uppercase tracking-wide">Products Due</div>
              </div>
              <div className="bg-muted/40 p-3 rounded-lg border border-border/50 text-center">
                <div className="text-2xl font-bold">{results.filter((r) => r.historicalEvidence?.status === "NOT_DUE").length}</div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Products Not Due</div>
              </div>
              <div className="bg-muted/40 p-3 rounded-lg border border-border/50 text-center">
                <div className="text-2xl font-bold">{results.filter((r) => r.historicalEvidence?.status === "PATTERN_NOT_USABLE" || !r.historicalEvidence).length}</div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Pattern Unusable / Missing</div>
              </div>
            </div>
          )}

          {/* Simple Policy Summary Rows */}
          {!isHistorical && summary.policyVersion === 3 && (
            <div className="bg-muted/10 p-4 rounded border mb-6 text-sm">
              <div className="flex flex-wrap gap-x-8 gap-y-2 mb-3 pb-3 border-b">
                {summary.noCompetitorUntouched != null && (
                  <div className="text-muted-foreground"><strong className="text-foreground">{summary.noCompetitorUntouched}</strong> no competitor price -- untouched</div>
                )}
                {summary.fallthroughUntouched != null && (
                  <div className="text-muted-foreground"><strong className="text-foreground">{summary.fallthroughUntouched}</strong> fallthrough -- untouched</div>
                )}
                {summary.salesValueRepresented != null && (
                  <div className="text-muted-foreground"><strong className="text-foreground text-emerald-700">₹{summary.salesValueRepresented.toLocaleString()}</strong> matched FY Sales</div>
                )}
              </div>

              {summary.tierDistribution && Object.keys(summary.tierDistribution).length > 0 && (
                <div className="flex flex-wrap gap-4 text-muted-foreground mb-3 pb-3 border-b">
                  <span className="font-semibold text-foreground text-xs uppercase">Volume Tiers:</span>
                  {Object.entries(summary.tierDistribution).map(([tier, count]) => (
                    <div key={tier} className="flex gap-2 text-xs">
                      <span className="font-medium text-foreground">Tier {tier}:</span>
                      <span>{count as number} products</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-col gap-2 text-muted-foreground">
                <span className="font-semibold text-foreground text-xs uppercase mt-0.5">Matched Rules:</span>
                {Object.entries(summary.rowCounts || {})
                  .sort(([a], [b]) => {
                    const na = parseInt(a.replace(/\D/g, "")) || 0;
                    const nb = parseInt(b.replace(/\D/g, "")) || 0;
                    return na - nb;
                  })
                  .map(([rowName, countsValue]) => {
                    const counts = countsValue as any;
                    return (
                    <div key={rowName} className="flex flex-wrap gap-x-4 gap-y-1 text-xs items-center p-1.5 bg-background rounded border">
                      <span className="font-medium text-sm text-foreground w-16">{rowName}</span>
                      <span>{counts.scopeMatched} matched scope</span>
                      <span>&middot;</span>
                      <span>{counts.withCompetitorPrice} have competitor price</span>
                      <span>&middot;</span>
                      <span>{counts.wouldChange} would change</span>
                      {counts.matchedFySalesValue != null && (
                        <>
                          <span>&middot;</span>
                          <span className="text-emerald-700">₹{counts.matchedFySalesValue.toLocaleString()} FY Sales</span>
                        </>
                      )}
                      {counts.tierDistribution && Object.keys(counts.tierDistribution).length > 0 && (
                        <>
                          <span>&middot;</span>
                          <div className="flex gap-2">
                            {Object.entries(counts.tierDistribution).map(([tier, tCount]) => (
                              <span key={tier} className="text-muted-foreground">[{tier}: {tCount as number}]</span>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                    );
                  })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="space-y-2 bg-muted/20 p-3 rounded border">
              <h3 className="font-semibold text-foreground border-b pb-1">Source Freshness</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <span className="text-muted-foreground">Snapshot:</span>
                <span className="text-right font-medium">{formatDisplayDate(freshness.asOf)}</span>
                <span className="text-muted-foreground">Prayag application DB:</span>
                <span className="text-right font-medium">
                  {freshness.mrpDates.length
                    ? `${formatDisplayDate(freshness.mrpDates[0])}${freshness.mrpDates.length > 1 ? ` – ${formatDisplayDate(freshness.mrpDates.at(-1)!)} ` : ""}`
                    : "No data"}
                </span>
                {freshness.competitors?.map((c: MrpGeneratorFreshnessCompetitor, i: number) => (
                  <React.Fragment key={i}>
                    <span className="text-muted-foreground">{c.competitor}:</span>
                    <span className={cn("text-right font-medium", c.stale && "text-amber-600 flex items-center justify-end gap-1")} title={c.stale ? `Data is ${c.ageDays || '?'} days old (stale)` : ""}>
                      {c.effectiveDate ? formatDisplayDate(c.effectiveDate) : "-"} {c.stale && <AlertTriangle className="w-3 h-3" />}
                    </span>
                  </React.Fragment>
                ))}
                <span className="text-muted-foreground">Sales application:</span>
                <span className="text-right font-medium">
                  {freshness.sales?.status === "authenticated" ? (
                    <span className="text-emerald-700">Available</span>
                  ) : (
                    <span className="text-amber-700">{freshness.sales?.status || "Unavailable"}</span>
                  )}
                </span>
              </div>
            </div>
            <div className="space-y-2 bg-muted/20 p-3 rounded border">
              <h3 className="font-semibold text-foreground border-b pb-1">Run KPIs</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <span className="text-muted-foreground">Median Increase:</span>
                <span className="text-right font-medium text-emerald-600">
                  {summary.medianIncreasePercent != null ? `+${summary.medianIncreasePercent.toFixed(1)}%` : "-"}
                </span>
                <span className="text-muted-foreground">Median Decrease:</span>
                <span className="text-right font-medium text-red-600">
                  {summary.medianDecreasePercent != null ? `${summary.medianDecreasePercent.toFixed(1)}%` : "-"}
                </span>
                <span className="text-muted-foreground">Confidence Pass:</span>
                <span className="text-right font-medium">
                  {summary.confidencePassCount != null ? summary.confidencePassCount : "-"}
                </span>
              </div>
            </div>
          </div>

          {/* Exclusion Breakdown */}
          {Object.keys(summary.exclusionReasonBreakdown || {}).length > 0 && (
            <div className="mt-4 bg-muted/20 p-3 rounded border text-sm">
              <h3 className="font-semibold text-foreground border-b pb-1 mb-2">Exclusion Reasons</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {Object.entries(summary.exclusionReasonBreakdown).map(([reason, count]) => (
                  <div key={reason} className="flex justify-between">
                    <span className="text-muted-foreground truncate pr-2" title={reason}>{reason}</span>
                    <span className="font-medium shrink-0">{count as React.ReactNode}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {summary.policyVersion === 2 && (
            <Card className="p-4 sm:p-5 shadow-sm mt-6 border-primary/20 bg-primary/5">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-primary mb-4 flex items-center gap-2">
                <Zap className="w-4 h-4" /> P011 Policy Analysis
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-sm">
                <div className="space-y-2 bg-card p-3 rounded border">
                   <h3 className="font-semibold text-foreground border-b pb-1">Value & Action Distribution</h3>
                   <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                     <span className="text-muted-foreground">Sales Value Represented:</span>
                     <span className="text-right font-medium">₹{summary.salesValueRepresented?.toLocaleString() ?? "0"}</span>

                     <span className="col-span-2 text-xs font-semibold uppercase mt-2 mb-1">Actions</span>
                     {Object.entries(summary.actionCounts || {}).map(([action, count]) => {
                       const impact = summary.actionValueImpacts?.[action];
                       return (
                         <React.Fragment key={action}>
                           <span className="text-muted-foreground">{action}:</span>
                           <span className="text-right text-xs">
                             {count as React.ReactNode} items<br/>
                             {impact ? (
                               <span className="text-muted-foreground">
                                 ₹{(impact.fySalesValue/1e5).toFixed(1)}L FY Sales<br/>
                                 Δ ₹{(impact.grossContributionDelta/1e5).toFixed(1)}L GC
                               </span>
                             ) : "-"}
                           </span>
                         </React.Fragment>
                       );
                     })}
                   </div>
                </div>

                <div className="space-y-2 bg-card p-3 rounded border">
                   <h3 className="font-semibold text-foreground border-b pb-1">Bands & Portfolio</h3>
                   <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                     <span className="col-span-2 text-xs font-semibold uppercase mt-1 mb-1">Bands</span>
                     {Object.entries(summary.bandDistribution || {}).map(([band, count]) => (
                       <React.Fragment key={band}>
                         <span className="text-muted-foreground">Band {band}:</span>
                         <span className="text-right">{count as React.ReactNode} items</span>
                       </React.Fragment>
                     ))}

                     {summary.portfolio && (
                       <>
                         <span className="col-span-2 text-xs font-semibold uppercase mt-2 mb-1">Portfolio</span>
                         <span className="text-muted-foreground">Current Gross Margin:</span>
                         <span className="text-right">{summary.portfolio.currentGrossMargin != null ? `${(summary.portfolio.currentGrossMargin * 100).toFixed(1)}%` : "-"}</span>

                         <span className="text-muted-foreground">Proposed Gross Margin:</span>
                         <span className="text-right">{summary.portfolio.proposedGrossMargin != null ? `${(summary.portfolio.proposedGrossMargin * 100).toFixed(1)}%` : "-"}</span>

                         <span className="text-muted-foreground">Delta Points:</span>
                         <span className="text-right">{summary.portfolio.deltaPoints != null ? `${summary.portfolio.deltaPoints > 0 ? "+" : ""}${summary.portfolio.deltaPoints.toFixed(1)}` : "-"}</span>

                         <span className="text-muted-foreground">Target Result:</span>
                         <span className="text-right font-medium">
                           {summary.portfolio.targetMet ? (
                             <span className="text-emerald-600">Met Target</span>
                           ) : (
                             <span className="text-red-600">Shortfall: {(summary.portfolio.shortfallPoints ?? 0).toFixed(1)} pts</span>
                           )}
                         </span>

                         <span className="text-muted-foreground">Coverage:</span>
                         <span className="text-right text-xs">
                            {summary.portfolio.coveredProductCount} items (₹{(summary.portfolio.coveredSalesValue/1e5).toFixed(1)}L)<br/>
                            {summary.portfolio.omittedProductCount} omitted (₹{(summary.portfolio.omittedSalesValue/1e5).toFixed(1)}L)
                         </span>
                       </>
                     )}
                   </div>
                </div>

                {summary.portfolio?.headroom && summary.portfolio.headroom.length > 0 && (
                  <div className="lg:col-span-2 space-y-2 bg-card p-3 rounded border">
                    <h3 className="font-semibold text-foreground border-b pb-1">Headroom Remaining</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-left">
                        <thead>
                          <tr className="border-b">
                            <th className="py-1">Item</th>
                            <th className="py-1">Band</th>
                            <th className="py-1 text-right">FY Value</th>
                            <th className="py-1 text-right">Rem. Price Δ</th>
                            <th className="py-1 text-right">Addl. GC</th>
                          </tr>
                        </thead>
                        <tbody>
                          {summary.portfolio.headroom.map((h: any) => (
                            <tr key={h.itemCode} className="border-b last:border-0 border-border/50">
                              <td className="py-1 font-medium">{h.itemCode}</td>
                              <td className="py-1">{h.band}</td>
                              <td className="py-1 text-right">₹{(h.fySalesValue/1e5).toFixed(1)}L</td>
                              <td className="py-1 text-right text-emerald-600">₹{h.additionalRealizedSaleValue.toLocaleString()}</td>
                              <td className="py-1 text-right text-emerald-600">₹{h.additionalGrossContribution.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}
        </Card>

        {/* Coverage Panel */}
        <Card className="p-4 sm:p-5 shadow-sm border-primary/20 bg-primary/5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground mb-4">Comprehensive Coverage & Evidence Limits</h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 text-sm">

            <div className="space-y-2 bg-card p-3 rounded border">
              <h3 className="font-semibold text-foreground border-b pb-1">Scope Counts</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <span className="text-muted-foreground">Catalog:</span>
                <span className="text-right font-medium">{freshness.coverageSummary?.catalogTotal ?? "Unavailable"}</span>

                <span className="text-muted-foreground">Sales (Has Data):</span>
                <span className="text-right font-medium">{freshness.coverageSummary?.withFySales ?? "Unavailable"}</span>

                <span className="text-muted-foreground">Sales (No Data):</span>
                <span className="text-right font-medium">{freshness.coverageSummary?.withoutFySales ?? "Unavailable"}</span>

                <span className="text-muted-foreground">Margin Available:</span>
                <span className="text-right font-medium">{freshness.coverageSummary?.withMargin ?? "Unavailable"}</span>

                <span className="text-muted-foreground">Confidence Pass:</span>
                <span className="text-right font-medium">{freshness.coverageSummary?.confidencePassCount ?? "Unavailable"}</span>
              </div>
            </div>

            <div className="space-y-2 bg-card p-3 rounded border">
              <h3 className="font-semibold text-foreground border-b pb-1">Data Age & Read Time</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <span className="text-muted-foreground">Prayag MRP:</span>
                <span className="text-right font-medium text-xs">
                  {freshness.mrpDates.length ? `${formatDisplayDate(freshness.mrpDates[0])}` : "Unavailable"}
                </span>

                {freshness.competitors?.map((c: MrpGeneratorFreshnessCompetitor, i: number) => (
                  <React.Fragment key={i}>
                    <span className="text-muted-foreground truncate">{c.competitor}:</span>
                    <span className={cn("text-right font-medium text-xs", c.stale && "text-amber-600")} title={c.stale ? `Data is ${c.ageDays || '?'} days old` : ""}>
                      {c.effectiveDate ? formatDisplayDate(c.effectiveDate) : "Unavailable"} {c.stale && <AlertTriangle className="inline w-3 h-3 ml-0.5" />}
                    </span>
                  </React.Fragment>
                ))}

                <span className="text-muted-foreground">Margin Latest Month:</span>
                <span className="text-right font-medium text-xs">{freshness.coverageSummary?.latestMonths?.margin || "Unavailable"}</span>

                <span className="text-muted-foreground">Margin Read Age:</span>
                <span className="text-right font-medium text-xs">{freshness.coverageSummary?.ages?.marginDays != null ? `${freshness.coverageSummary.ages.marginDays} days` : "Unavailable"}</span>

                <span className="text-muted-foreground">Sales Period:</span>
                <span className="text-right font-medium text-xs">{freshness.coverageSummary?.periods?.sales?.fy || "Unavailable"}</span>

                <span className="text-muted-foreground">Sales Provisional:</span>
                <span className="text-right font-medium text-xs">{(freshness.coverageSummary?.provisional?.sales?.length ?? 0) > 0 ? "Yes" : "No"}</span>

                <span className="text-muted-foreground">Sales Read Time:</span>
                <span className="text-right font-medium text-xs">{freshness.coverageSummary?.readAt?.sales ? new Date(freshness.coverageSummary.readAt.sales).toLocaleString() : "Unavailable"}</span>
              </div>
            </div>

            <div className="space-y-2 bg-card p-3 rounded border">
              <h3 className="font-semibold text-foreground border-b pb-1">Known Limits & Variance</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <span className="text-muted-foreground">Data Source:</span>
                <span className="text-right font-medium truncate">{freshness.coverageSummary?.dataSource || "Unavailable"}</span>

                <span className="text-muted-foreground">Recon Variance:</span>
                <span className="text-right font-medium">{freshness.coverageSummary?.reconciliation?.sales?.variance != null ? `₹${freshness.coverageSummary.reconciliation.sales.variance.toLocaleString()}` : "Unavailable"}</span>

                <span className="text-muted-foreground">Recon Control:</span>
                <span className="text-right font-medium">{freshness.coverageSummary?.reconciliation?.sales?.control != null ? `₹${freshness.coverageSummary.reconciliation.sales.control.toLocaleString()}` : "Unavailable"}</span>

                <span className="text-muted-foreground">Recon Actual:</span>
                <span className="text-right font-medium">{freshness.coverageSummary?.reconciliation?.sales?.actual != null ? `₹${freshness.coverageSummary.reconciliation.sales.actual.toLocaleString()}` : "Unavailable"}</span>

                <span className="text-muted-foreground">Recon Pct:</span>
                <span className="text-right font-medium">{freshness.coverageSummary?.reconciliation?.sales?.variancePct != null ? `${freshness.coverageSummary.reconciliation.sales.variancePct.toFixed(2)}%` : "Unavailable"}</span>

                <span className="text-muted-foreground">Awaiting Conf (Count):</span>
                <span className="text-right font-medium">{freshness.coverageSummary?.awaitingConfirmation?.count ?? "Unavailable"}</span>

                <span className="text-muted-foreground">Awaiting Conf (Value):</span>
                <span className="text-right font-medium">{freshness.coverageSummary?.awaitingConfirmation?.value != null ? `₹${freshness.coverageSummary.awaitingConfirmation.value.toLocaleString()}` : "Unavailable"}</span>

                <span className="text-muted-foreground col-span-2 mt-1 border-t pt-1">Awaiting Conf (List):</span>
                <span className="col-span-2 text-right font-medium text-amber-700">
                  {((freshness.coverageSummary?.awaitingConfirmation?.codes) || []).join(", ") || "Unavailable"}
                </span>

                <span className="text-muted-foreground">Absent Sold Codes:</span>
                <span className="text-right font-medium">{freshness.coverageSummary?.absentSoldCodes?.count ?? "Unavailable"}</span>

                <span className="text-muted-foreground">Absent Sold Value:</span>
                <span className="text-right font-medium">{freshness.coverageSummary?.absentSoldCodes?.value != null ? `₹${freshness.coverageSummary.absentSoldCodes.value.toLocaleString()}` : "Unavailable"}</span>

                <span className="text-muted-foreground col-span-2 mt-1 border-t pt-1">Named Holds / Reasons:</span>
                <span className="col-span-2 text-right font-medium text-amber-700">
                  {((freshness.coverageSummary?.holds?.margin) || []).join(", ") || "Unavailable"}
                </span>

                <span className="text-muted-foreground col-span-2 mt-1 border-t pt-1">Unavailable Months:</span>
                <span className="col-span-2 text-right font-medium text-amber-700">
                  {((freshness.coverageSummary?.unavailable?.margin) || []).join(", ") || "Unavailable"}
                </span>
              </div>
            </div>
          </div>
        </Card>

        {/* Historical Series Analysis */}
        {isHistorical && historicalSeries.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Historical Series Analysis</h2>
            <div className="bg-card border rounded-lg overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted/40 text-muted-foreground uppercase tracking-wider">
                    <tr className="border-b">
                      <th className="p-3 font-semibold">Series</th>
                      <th className="p-3 font-semibold text-right">Products</th>
                      <th className="p-3 font-semibold text-right">Revisions</th>
                      <th className="p-3 font-semibold text-right">Cadence</th>
                      <th className="p-3 font-semibold text-right">Typ. Rate</th>
                      <th className="p-3 font-semibold text-right">Spread (P10-P90)</th>
                      <th className="p-3 font-semibold">Confidence</th>
                      <th className="p-3 font-semibold">Last Revised</th>
                      <th className="p-3 font-semibold">Status / Next Expected</th>
                      <th className="p-3 font-semibold">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {historicalSeries.map((s: any, idx: number) => (
                      <tr key={idx} className={cn("hover:bg-muted/10 transition-colors", !s.usable && "text-muted-foreground")}>
                        <td className="p-3 font-medium text-foreground">{s.series}</td>
                        <td className="p-3 text-right">{s.productCount}</td>
                        <td className="p-3 text-right">
                          <div title={s.revisionDates?.map((d: string) => formatDisplayDate(d)).join(", ")}>
                            {s.revisionCount}
                          </div>
                        </td>
                        <td className="p-3 text-right">{s.cadenceMonths != null ? `${s.cadenceMonths} mo` : "-"}</td>
                        <td className={cn("p-3 text-right", s.usable && "font-medium text-primary")}>
                          {s.typicalRate != null ? `${Number(s.typicalRate).toFixed(1)}%` : "-"}
                        </td>
                        <td className="p-3 text-right">
                          {s.p10Rate != null && s.p90Rate != null ? `${Number(s.p10Rate).toFixed(1)}% - ${Number(s.p90Rate).toFixed(1)}%` : "-"}
                        </td>
                        <td className="p-3 font-medium">{s.confidence?.replace(/_/g, " ") || "-"}</td>
                        <td className="p-3">{s.lastRevisionDate ? formatDisplayDate(s.lastRevisionDate) : "-"}</td>
                        <td className="p-3">
                          <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold uppercase mr-2",
                            s.status === "DUE" || s.status === "OVERDUE" ? "bg-amber-100 text-amber-800" :
                            s.status === "NOT_DUE" ? "bg-emerald-100 text-emerald-800" :
                            "bg-muted text-muted-foreground"
                          )}>
                            {s.status?.replace(/_/g, " ") || "-"}
                          </span>
                          {s.nextExpectedDate ? formatDisplayDate(s.nextExpectedDate) : ""}
                        </td>
                        <td className="p-3">
                          {!s.usable && s.reason ? <span className="text-destructive/80">{s.reason}</span> : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Results */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Run Results</h2>
            <div className="flex flex-wrap items-center gap-2">
              <Input placeholder="Search item code or name..." value={search} onChange={e => setSearch(e.target.value)} className="h-8 w-64 bg-card" />
              {summary.policyVersion === 2 && (
                <>
                  <select className="h-8 rounded-md border border-input bg-card px-2 text-xs" value={filterBand} onChange={e => setFilterBand(e.target.value)}>
                    <option value="_all">All Bands</option>
                    <option value="A">Band A</option>
                    <option value="B">Band B</option>
                    <option value="C">Band C</option>
                    <option value="D">Band D</option>
                    <option value="E">Band E</option>
                    <option value="F">Band F</option>
                  </select>
                  <select className="h-8 rounded-md border border-input bg-card px-2 text-xs" value={filterAction} onChange={e => setFilterAction(e.target.value)}>
                    <option value="_all">All Actions</option>
                    <option value="CAPTURE">Capture</option>
                    <option value="DEFEND">Defend</option>
                    <option value="HOLD">Hold</option>
                    <option value="REVIEW">Review</option>
                    <option value="LEAVE_ALONE">Leave Alone</option>
                    <option value="MARGIN_ONLY">Margin Only</option>
                    <option value="EXCLUDED">Excluded</option>
                  </select>
                  <select className="h-8 rounded-md border border-input bg-card px-2 text-xs" value={filterPosition} onChange={e => setFilterPosition(e.target.value)}>
                    <option value="_all">All Positions</option>
                    <option value="well_below">Well Below</option>
                    <option value="parity">Parity</option>
                    <option value="above">Above</option>
                  </select>
                  <select className="h-8 rounded-md border border-input bg-card px-2 text-xs" value={filterEscalation} onChange={e => setFilterEscalation(e.target.value)}>
                    <option value="_all">Escalation: Any</option>
                    <option value="yes">Escalated</option>
                    <option value="no">Not Escalated</option>
                  </select>
                </>
              )}
            </div>
          </div>

          <div className="bg-card border rounded-lg overflow-hidden shadow-sm">
            <div className={cn("grid items-center gap-2 p-3 border-b bg-muted/40 text-xs font-semibold text-muted-foreground uppercase tracking-wider",
              isHistorical ? "grid-cols-[minmax(0,1fr)_100px_100px_100px_120px_120px_40px]" :
              summary.policyVersion === 2 ? "grid-cols-[40px_minmax(0,1fr)_60px_100px_100px_100px_100px_100px_40px]" :
              "grid-cols-[40px_minmax(0,1fr)_120px_120px_120px_100px_40px]")}>
              {!isHistorical && (
                <div className="flex justify-center">
                  <Checkbox checked={selectedRows.size > 0} onCheckedChange={selectAllEligible} aria-label="Select eligible" />
                </div>
              )}
              <div>Product</div>
              {!isHistorical && summary.policyVersion === 2 && <div className="text-center">Band</div>}
              <div className="text-right">Current MRP</div>
              {isHistorical ? (
                <>
                  <div className="text-right">Suggested</div>
                  <div className="text-right">Typ. Rate</div>
                  <div className="text-right">Next Expected</div>
                  <div className="text-center">Hist. Status</div>
                </>
              ) : (
                <>
                  <div className="text-right">Suggested</div>
                  <div className="text-right">Change</div>
                  {summary.policyVersion === 2 && <div className="text-center">Action</div>}
                  <div className="text-center">Status</div>
                </>
              )}
              <div></div>
            </div>

            <div className="divide-y max-h-[600px] overflow-y-auto">
              {filteredResults.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">No results match.</div>
              ) : (
                filteredResults.map((r) => {
                  const isEligible = r.status === "suggested";
                  const expanded = expandedRows.has(r.itemCode);
                  const historicalEvidence = r.historicalEvidence as any;
                  return (
                    <div key={r.itemCode} className={cn("transition-colors hover:bg-muted/10", expanded && "bg-muted/10")}>
                      <div className={cn("grid items-center gap-2 p-3 text-sm",
                        isHistorical ? "grid-cols-[minmax(0,1fr)_100px_100px_100px_120px_120px_40px]" :
                        summary.policyVersion === 2 ? "grid-cols-[40px_minmax(0,1fr)_60px_100px_100px_100px_100px_100px_40px]" :
                        "grid-cols-[40px_minmax(0,1fr)_120px_120px_120px_100px_40px]")}>
                        {!isHistorical && (
                          <div className="flex justify-center">
                            <Checkbox disabled={!isEligible} checked={selectedRows.has(r.itemCode)} onCheckedChange={() => toggleSelect(r.itemCode)} />
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="font-medium text-foreground truncate">{r.itemCode}</div>
                          <div className="text-xs text-muted-foreground truncate">{r.productName || "-"}</div>
                        </div>
                        {!isHistorical && summary.policyVersion === 2 && (
                          <div className="text-center font-bold text-muted-foreground">{r.band || "-"}</div>
                        )}
                        <div className="text-right text-muted-foreground">
                          {r.currentMrp != null ? `₹${r.currentMrp.toFixed(2)}` : "No data"}
                        </div>
                        {isHistorical ? (
                          <>
                            <div className="text-right font-semibold">
                              {r.suggestedMrp != null ? `₹${r.suggestedMrp.toFixed(2)}` : "No data"}
                            </div>
                            <div className="text-right text-muted-foreground">
                              {historicalEvidence?.typicalRate != null ? `${(historicalEvidence.typicalRate).toFixed(1)}%` : "-"}
                            </div>
                            <div className="text-right text-muted-foreground">
                              {historicalEvidence?.nextExpectedDate ? formatDisplayDate(historicalEvidence.nextExpectedDate as string) : "-"}
                            </div>
                            <div className="flex justify-center">
                              <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                                historicalEvidence?.status === "DUE" || historicalEvidence?.status === "OVERDUE" ? "bg-amber-100 text-amber-800" :
                                historicalEvidence?.status === "NOT_DUE" ? "bg-emerald-100 text-emerald-800" :
                                "bg-muted text-muted-foreground"
                              )}>
                                {String(historicalEvidence?.status || "-").replace(/_/g, " ")}
                              </span>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="text-right font-semibold">
                              {r.suggestedMrp != null ? `₹${r.suggestedMrp.toFixed(2)}` : "No data"}
                            </div>
                            <div className={cn("text-right font-medium", (r.changePercent || 0) > 0 ? "text-emerald-600" : (r.changePercent || 0) < 0 ? "text-red-600" : "text-muted-foreground")}>
                              {r.changePercent != null ? `${r.changePercent > 0 ? "+" : ""}${r.changePercent.toFixed(1)}%` : "—"}
                            </div>
                            {summary.policyVersion === 2 && (
                              <div className="flex justify-center">
                                <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                                  r.action === "CAPTURE" ? "bg-emerald-100 text-emerald-800" :
                                  r.action === "DEFEND" ? "bg-amber-100 text-amber-800" :
                                  r.action === "HOLD" ? "bg-blue-100 text-blue-800" :
                                  r.action === "REVIEW" ? "bg-purple-100 text-purple-800" :
                                  r.action === "EXCLUDED" ? "bg-muted text-muted-foreground" :
                                  "bg-gray-100 text-gray-800"
                                )}>
                                  {r.action || "-"}
                                </span>
                              </div>
                            )}
                            <div className="flex justify-center">
                              <span className={cn(
                                "px-2 py-0.5 rounded text-xs uppercase font-medium",
                                r.status === "suggested" ? "bg-primary/10 text-primary" :
                                r.status === "excluded" ? "bg-muted text-muted-foreground" :
                                "bg-border/50 text-foreground"
                              )}>
                                {r.status === "no_change" ? "No Change" : r.status}
                              </span>
                            </div>
                          </>
                        )}
                        <button onClick={() => toggleRow(r.itemCode)} className="p-1 rounded hover:bg-accent flex justify-center text-muted-foreground">
                          <ChevronDown className={cn("w-4 h-4 transition-transform", expanded && "rotate-180")} />
                        </button>
                      </div>

                      {summary.policyVersion === 3 && (r.decisionSentence || r.matchedRowLabel || r.salesEvidence) && (
                        <div className="grid grid-cols-[40px_minmax(0,1fr)_120px_120px_120px_100px_40px] px-3 pb-3 text-xs text-muted-foreground">
                          <div className="col-start-2 col-end-7 flex flex-wrap items-center gap-2">
                            {r.matchedRowLabel && (
                              <>
                                <span className="font-medium text-foreground">{r.matchedRowNumber ? `Row ${r.matchedRowNumber}: ` : ""}{r.matchedRowLabel}</span>
                                <span>&middot;</span>
                                <span>{r.decisionSentence}</span>
                                {r.selectedCompetitorPrice != null && <span className="font-medium">&rarr; Rs {r.selectedCompetitorPrice}</span>}
                              </>
                            )}
                            {r.salesEvidence && (
                              <>
                                {r.matchedRowLabel && <span className="mx-2 border-l h-3 border-border"></span>}
                                <span className="font-medium text-emerald-700">Tier {r.salesEvidence.tier || "F"}</span>
                                <span>(₹{r.salesEvidence.salesAmount?.toLocaleString() || "0"} FY Sales)</span>
                              </>
                            )}
                          </div>
                        </div>
                      )}

                      {expanded && (
                        <div className="px-[50px] pb-4 space-y-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mt-2">
                            {/* Evidence Panel */}
                            <div className="bg-background border rounded p-3 space-y-2">
                              <h4 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground border-b pb-1">Price Evidence</h4>
                              <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
                                <span className="text-muted-foreground">Current MRP Date:</span>
                                <span className="text-right">{r.currentDate ? formatDisplayDate(r.currentDate) : "-"}</span>
                                {r.exclusions?.length > 0 && (
                                  <>
                                    <span className="text-muted-foreground">Exclusions:</span>
                                    <span className="text-right text-destructive">{r.exclusions.join(", ")}</span>
                                  </>
                                )}
                              </div>

                              {isMatching && (
                                <div className="mt-3 space-y-1">
                                  <h5 className="text-[10px] uppercase font-semibold text-muted-foreground">Matching Action</h5>
                                  <div className="bg-muted/20 p-2 border rounded">
                                    {r.trace?.filter((t: any) => t.ruleType === "matching_manual_action").map((t: any, i: number) => (
                                      <div key={i} className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
                                        <span className="text-muted-foreground">Source:</span>
                                        <span className="font-medium capitalize text-foreground">{t.source || "manual"}</span>
                                        <span className="text-muted-foreground">Action:</span>
                                        <span className="font-medium capitalize text-primary">{String(t.action).replace(/_/g, ' ')}</span>
                                        <span className="text-muted-foreground">Driver/Reason:</span>
                                        <span>{t.driver || "N/A"} - {t.reason}</span>
                                        <span className="text-muted-foreground">Actor:</span>
                                        <span>{t.actor || "System"}</span>
                                        {t.evidence && (
                                          <>
                                            <span className="text-muted-foreground">Target Evidence:</span>
                                            <span className="text-emerald-700 font-medium">₹{t.evidence.effectivePrice?.toFixed(2)} ({t.evidence.competitor})</span>
                                          </>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {historicalEvidence && (
                                <div className="mt-3 space-y-1">
                                  <h5 className="text-[10px] uppercase font-semibold text-muted-foreground">Historical Evidence</h5>
                                  <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs bg-muted/20 p-2 border rounded">
                                    <span className="text-muted-foreground">Series:</span>
                                    <span className="text-right font-medium">{historicalEvidence.series || "None"}</span>
                                    <span className="text-muted-foreground">Revision Count:</span>
                                    <span className="text-right">{historicalEvidence.revisionDates?.length || 0}</span>
                                    {historicalEvidence.cadenceMonths != null && (
                                      <>
                                        <span className="text-muted-foreground">Cadence:</span>
                                        <span className="text-right">{historicalEvidence.cadenceMonths} months</span>
                                      </>
                                    )}
                                    {historicalEvidence.typicalRate != null && (
                                      <>
                                        <span className="text-muted-foreground">Typical Rate:</span>
                                        <span className="text-right font-medium text-primary">{Number(historicalEvidence.typicalRate).toFixed(1)}%</span>
                                      </>
                                    )}
                                    {historicalEvidence.p10Rate != null && historicalEvidence.p90Rate != null && (
                                      <>
                                        <span className="text-muted-foreground">P10 - P90 Spread:</span>
                                        <span className="text-right text-muted-foreground">{Number(historicalEvidence.p10Rate).toFixed(1)}% - {Number(historicalEvidence.p90Rate).toFixed(1)}%</span>
                                      </>
                                    )}
                                    {historicalEvidence.spreadPoints != null && (
                                      <>
                                        <span className="text-muted-foreground">Spread Points:</span>
                                        <span className="text-right">{Number(historicalEvidence.spreadPoints).toFixed(1)}</span>
                                      </>
                                    )}
                                    <span className="text-muted-foreground">Confidence:</span>
                                    <span className="text-right font-medium">{historicalEvidence.confidence || "-"}</span>
                                    {historicalEvidence.monthsSinceLast != null && (
                                      <>
                                        <span className="text-muted-foreground">Months Since Last:</span>
                                        <span className="text-right">{historicalEvidence.monthsSinceLast}</span>
                                      </>
                                    )}
                                    {r.reason && (
                                      <>
                                        <span className="text-muted-foreground">Reason:</span>
                                        <span className="text-right text-muted-foreground">{r.reason}</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              )}

                              {r.salesEvidence && (
                                <div className="mt-3 space-y-1">
                                  <h5 className="text-[10px] uppercase font-semibold text-muted-foreground">Sales Evidence</h5>
                                  <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs bg-muted/20 p-2 border rounded">
                                    <span className="text-muted-foreground">Sales Amount:</span>
                                    <span className="text-right">₹{r.salesEvidence.salesAmount?.toLocaleString() || "0"}</span>
                                    <span className="text-muted-foreground">Quantity:</span>
                                    <span className="text-right">{r.salesEvidence.qtyUnknown ? "Unknown" : r.salesEvidence.qty}</span>
                                    <span className="text-muted-foreground">FY Sales Exists:</span>
                                    <span className="text-right">{r.salesEvidence.fySalesExists ? "Yes" : "No"}</span>
                                    {r.salesEvidence.tier && (
                                      <>
                                        <span className="text-muted-foreground">Tier:</span>
                                        <span className="text-right font-medium">{r.salesEvidence.tier}</span>
                                      </>
                                    )}
                                    {r.salesEvidence.awaitingConfirmation && (
                                      <>
                                        <span className="text-muted-foreground">Awaiting Conf:</span>
                                        <span className="text-right text-amber-700">Yes</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              )}

                              {r.marginEvidence && (
                                <div className="mt-3 space-y-1">
                                  <h5 className="text-[10px] uppercase font-semibold text-muted-foreground">Margin Evidence</h5>
                                  <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs bg-muted/20 p-2 border rounded">
                                    <span className="text-muted-foreground">Gross Margin:</span>
                                    <span className="text-right font-medium">{r.marginEvidence.grossMarginPct != null ? `${(r.marginEvidence.grossMarginPct * 100).toFixed(1)}%` : "N/A"}</span>
                                    <span className="text-muted-foreground">Latest Month:</span>
                                    <span className="text-right">{r.marginEvidence.latestMonth || "N/A"}</span>
                                    {r.marginEvidence.saleValue != null && (
                                      <>
                                        <span className="text-muted-foreground">Sale Value:</span>
                                        <span className="text-right">₹{r.marginEvidence.saleValue.toFixed(2)}</span>
                                      </>
                                    )}
                                    {r.marginEvidence.bomValue != null && (
                                      <>
                                        <span className="text-muted-foreground">BOM Value:</span>
                                        <span className="text-right">₹{r.marginEvidence.bomValue.toFixed(2)}</span>
                                      </>
                                    )}
                                    {r.marginEvidence.unitBomValue != null && (
                                      <>
                                        <span className="text-muted-foreground">Unit BOM Value:</span>
                                        <span className="text-right">₹{r.marginEvidence.unitBomValue.toFixed(2)}</span>
                                      </>
                                    )}
                                    <span className="text-muted-foreground">Qty Unknown:</span>
                                    <span className="text-right">{r.marginEvidence.qtyUnknown ? "Yes" : "No"}</span>
                                    <span className="text-muted-foreground">Held:</span>
                                    <span className="text-right text-amber-700">{r.marginEvidence.held ? "Yes" : "No"}</span>
                                  </div>
                                </div>
                              )}

                              {summary.policyVersion === 2 && (
                                <div className="bg-primary/5 border border-primary/20 rounded p-3 space-y-2 mt-3 text-xs">
                                  <h4 className="font-semibold uppercase tracking-wider text-primary border-b border-primary/10 pb-1">P011 Policy Reasoning</h4>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2">
                                     <div>
                                       <span className="text-muted-foreground mr-2">Chosen Competitor:</span>
                                       <span className="font-medium">{r.selectedCompetitor || "None"} ({r.competitorMode || "n/a"})</span>
                                     </div>
                                     <div>
                                       <span className="text-muted-foreground mr-2">FY Sales Value:</span>
                                       <span className="font-medium">{r.fySalesAmount != null ? `₹${r.fySalesAmount.toLocaleString()}` : "No Data"}</span>
                                     </div>
                                     <div>
                                       <span className="text-muted-foreground mr-2">Gap & Position:</span>
                                       <span className="font-medium">{r.gap != null ? `${(r.gap * 100).toFixed(1)}%` : "N/A"} → {r.position || "N/A"}</span>
                                     </div>
                                     <div>
                                       <span className="text-muted-foreground mr-2">Binding Constraints:</span>
                                       <span className="font-medium text-amber-700">{r.bindingConstraints?.join(", ") || "None"}</span>
                                     </div>
                                     <div className="col-span-1 md:col-span-2">
                                       <span className="text-muted-foreground mr-2">Competitive Target:</span>
                                       <span className="font-medium">{r.competitiveTarget != null ? `₹${r.competitiveTarget.toFixed(2)}` : "None"}</span>
                                     </div>
                                     {r.marginFloorEvidence && (
                                       <div className="col-span-1 md:col-span-2 grid grid-cols-2 gap-x-2 gap-y-1 bg-muted/20 p-2 border rounded">
                                         <span className="text-muted-foreground">Floor Category:</span>
                                         <span className="text-right font-medium">{r.marginFloorEvidence.category || "None"}</span>
                                         <span className="text-muted-foreground">Category Floor:</span>
                                         <span className="text-right">{r.marginFloorEvidence.floorPercent != null ? `${r.marginFloorEvidence.floorPercent.toFixed(1)}%` : "N/A"}</span>
                                         <span className="text-muted-foreground">Minimum MRP:</span>
                                         <span className="text-right">{r.marginFloorEvidence.minimumMrp != null ? `₹${r.marginFloorEvidence.minimumMrp.toFixed(2)}` : "N/A"}</span>
                                       </div>
                                     )}
                                     {r.escalation && (
                                       <div className="col-span-1 md:col-span-2 flex gap-2 p-2 bg-destructive/10 text-destructive rounded mt-1">
                                         <AlertTriangle className="w-4 h-4 shrink-0" />
                                         <span><span className="font-bold">Escalation:</span> {r.escalationReason || "Unknown reason"}</span>
                                       </div>
                                     )}
                                  </div>
                                </div>
                              )}

                              {r.warnings?.length > 0 && (
                                <div className="mt-3 space-y-1">
                                  <h5 className="text-[10px] uppercase font-semibold text-amber-700">Warnings</h5>
                                  <ul className="list-disc pl-4 text-xs text-amber-700">
                                    {r.warnings.map((w: string, i: number) => (
                                      <li key={i}>{w}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {r.competitorValues?.length > 0 && (
                                <div className="mt-3 space-y-1">
                                  <h5 className="text-[10px] uppercase font-semibold text-muted-foreground">Competitors</h5>
                                  {r.competitorValues.map((c: MrpGeneratorCompetitorValue, i: number) => (
                                    <div key={i} className={cn("flex items-center justify-between gap-3 rounded border p-2 text-xs", c.stale ? "border-amber-300 bg-amber-50" : "bg-muted/40")}>
                                      <span className="font-medium">
                                        {c.competitor}
                                        {c.stale && <span className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 font-semibold text-amber-900">18+ months old</span>}
                                      </span>
                                      <div className="text-right">
                                        <div>{c.effectivePrice != null ? `₹${c.effectivePrice.toFixed(2)}` : "No data"}</div>
                                        <div className={cn("text-muted-foreground", c.stale && "font-medium text-amber-800")}>
                                          {c.effectiveDate ? formatDisplayDate(c.effectiveDate) : "Undated"}
                                          {c.ageDays != null && ` · ${c.ageDays} days old`}
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Rule Trace Panel */}
                            {!isHistorical && (
                              <div className="bg-background border rounded p-3 space-y-2">
                                <h4 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground border-b pb-1">Rule Trace</h4>
                                <div className="space-y-1.5 mt-2">
                                  {r.trace?.map((t: MrpGeneratorTrace, i: number) => (
                                    <div key={i} className={cn("text-xs flex items-start gap-2 p-1.5 rounded border-l-2",
                                      t.outcome === "fired" ? "border-primary bg-primary/5" :
                                      t.outcome === "blocked" ? "border-destructive bg-destructive/5 text-muted-foreground" :
                                      "border-muted bg-muted/30 text-muted-foreground opacity-70"
                                    )}>
                                      <div className="shrink-0 pt-0.5">
                                        {t.outcome === "fired" ? <Check className="w-3 h-3 text-primary" /> :
                                         t.outcome === "blocked" ? <X className="w-3 h-3 text-destructive" /> :
                                         <ChevronRight className="w-3 h-3" />}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <span className="font-medium mr-1">{t.ruleType}:</span>
                                        <span>{t.reason}</span>
                                        {t.target !== undefined && t.target !== null && t.outcome === "fired" && (
                                          <span className="block mt-0.5 font-mono text-[10px] text-foreground">→ ₹{t.target.toFixed(2)}</span>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                  {r.bindingConstraint && (
                                    <div className="text-xs bg-amber-50 text-amber-800 border border-amber-200 p-1.5 rounded mt-2 flex items-center gap-1.5">
                                      <Zap className="w-3 h-3 shrink-0" />
                                      <span>Binding Constraint: <strong>{r.bindingConstraint}</strong></span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
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

      {/* Floating Handoff Bar */}
      {!isHistorical && selectedRows.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-10 border-t bg-card/95 backdrop-blur shadow-[0_-4px_10px_-4px_rgba(0,0,0,0.1)] p-4 md:left-56 lg:left-56">
          <div className="max-w-[1600px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-sm font-medium">
              <span className="text-primary mr-1">{selectedRows.size}</span>
              products selected for revision handoff
            </div>
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <p className="hidden md:block text-xs text-muted-foreground max-w-sm text-right">
                Creates a preview in the Product Database. Never applies prices directly.
              </p>
              <Button onClick={handleHandoff} disabled={handoffMutation.isPending} className="w-full sm:w-auto shrink-0">
                {handoffMutation.isPending ? "Preparing..." : "Create Revision Preview"} <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
