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
  const summary = run.summary;
  const freshness = run.sourceFreshness;

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

  const filteredResults = results.filter((r) =>
    !search ||
    r.itemCode.toLowerCase().includes(search.toLowerCase()) ||
    (r.productName || "").toLowerCase().includes(search.toLowerCase())
  );

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
      "suggested_mrp", "change_percent", "status", "binding_constraint", "exclusions",
      "competitor_evidence", "rule_trace", "sales_evidence", "margin_evidence", "warnings"
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
      result.bindingConstraint,
      result.exclusions.join(" | "),
      result.competitorValues.map((competitor) =>
        `${competitor.competitor}: ${competitor.effectivePrice ?? "No data"} @ ${competitor.effectiveDate ?? "undated"} (${competitor.ageDays ?? "unknown"} days${competitor.stale ? ", stale" : ""})`,
      ).join(" | "),
      result.trace.map((trace) => `${trace.order + 1}. ${trace.ruleType} [${trace.outcome}] ${trace.reason}`).join(" | "),
      result.salesEvidence ? `Amt: ${result.salesEvidence.salesAmount}, Tier: ${result.salesEvidence.tier || "N/A"}` : "No data",
      result.marginEvidence ? `Margin: ${result.marginEvidence.grossMarginPct != null ? (result.marginEvidence.grossMarginPct * 100).toFixed(1) + '%' : "N/A"} (${result.marginEvidence.latestMonth || "N/A"})` : "No data",
      result.warnings?.join(" | ") || ""
    ]);
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
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <div className="bg-muted/40 p-3 rounded-lg border border-border/50 text-center">
              <div className="text-2xl font-bold">{summary.total || 0}</div>
              <div className="text-xs text-muted-foreground uppercase tracking-wide">Total Analyzed</div>
            </div>
            <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-100 text-center">
              <div className="text-2xl font-bold text-emerald-700">{summary.increases || 0}</div>
              <div className="text-xs text-emerald-600/80 uppercase tracking-wide">Increases</div>
            </div>
            <div className="bg-red-50 p-3 rounded-lg border border-red-100 text-center">
              <div className="text-2xl font-bold text-red-700">{summary.decreases || 0}</div>
              <div className="text-xs text-red-600/80 uppercase tracking-wide">Decreases</div>
            </div>
            <div className="bg-muted/40 p-3 rounded-lg border border-border/50 text-center">
              <div className="text-2xl font-bold">{summary.noChange || 0}</div>
              <div className="text-xs text-muted-foreground uppercase tracking-wide">No Change</div>
            </div>
            <div className="bg-muted/40 p-3 rounded-lg border border-border/50 text-center">
              <div className="text-2xl font-bold">{summary.excluded || 0}</div>
              <div className="text-xs text-muted-foreground uppercase tracking-wide">Excluded</div>
            </div>
          </div>

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

        {/* Results */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Run Results</h2>
            <div className="flex items-center gap-2">
              <Input placeholder="Search item code or name..." value={search} onChange={e => setSearch(e.target.value)} className="h-8 w-64 bg-card" />
            </div>
          </div>

          <div className="bg-card border rounded-lg overflow-hidden shadow-sm">
            <div className="grid grid-cols-[40px_minmax(0,1fr)_120px_120px_120px_100px_40px] items-center gap-2 p-3 border-b bg-muted/40 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <div className="flex justify-center">
                <Checkbox checked={selectedRows.size > 0} onCheckedChange={selectAllEligible} aria-label="Select eligible" />
              </div>
              <div>Product</div>
              <div className="text-right">Current MRP</div>
              <div className="text-right">Suggested</div>
              <div className="text-right">Change</div>
              <div className="text-center">Status</div>
              <div></div>
            </div>

            <div className="divide-y max-h-[600px] overflow-y-auto">
              {filteredResults.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">No results match.</div>
              ) : (
                filteredResults.map((r) => {
                  const isEligible = r.status === "suggested";
                  const expanded = expandedRows.has(r.itemCode);
                  return (
                    <div key={r.itemCode} className={cn("transition-colors hover:bg-muted/10", expanded && "bg-muted/10")}>
                      <div className="grid grid-cols-[40px_minmax(0,1fr)_120px_120px_120px_100px_40px] items-center gap-2 p-3 text-sm">
                        <div className="flex justify-center">
                          <Checkbox disabled={!isEligible} checked={selectedRows.has(r.itemCode)} onCheckedChange={() => toggleSelect(r.itemCode)} />
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-foreground truncate">{r.itemCode}</div>
                          <div className="text-xs text-muted-foreground truncate">{r.productName || "-"}</div>
                        </div>
                        <div className="text-right text-muted-foreground">
                          {r.currentMrp != null ? `₹${r.currentMrp.toFixed(2)}` : "No data"}
                        </div>
                        <div className="text-right font-semibold">
                          {r.suggestedMrp != null ? `₹${r.suggestedMrp.toFixed(2)}` : "No data"}
                        </div>
                        <div className={cn("text-right font-medium", (r.changePercent || 0) > 0 ? "text-emerald-600" : (r.changePercent || 0) < 0 ? "text-red-600" : "text-muted-foreground")}>
                          {r.changePercent != null ? `${r.changePercent > 0 ? "+" : ""}${r.changePercent.toFixed(1)}%` : "—"}
                        </div>
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
                        <button onClick={() => toggleRow(r.itemCode)} className="p-1 rounded hover:bg-accent flex justify-center text-muted-foreground">
                          <ChevronDown className={cn("w-4 h-4 transition-transform", expanded && "rotate-180")} />
                        </button>
                      </div>

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
                                    <span className={cn("text-right", r.marginEvidence.held && "text-amber-700 font-medium")}>{r.marginEvidence.held ? "Yes" : "No"}</span>
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
      {selectedRows.size > 0 && (
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
