/**
 * /import-review/:batchId
 *
 * Review staged rows from a PDF catalogue import before committing them
 * to competitor_prices. Shows four tabs:
 *   Needs Review — code-matched but description/size disagreed, or alias matches
 *   Ready        — clean code+desc matches
 *   Not Found    — products in the mapping that weren't found in the catalogue
 *   New Products — extracted items with no existing mapping
 *
 * Approve: commits all ok + needs_review rows to competitor_prices.
 * Discard: drops staging rows, marks batch discarded (kept for audit).
 * Export:  downloads a review Excel for offline checking.
 */

import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2,
  XCircle,
  Download,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Loader2,
  ArrowLeft,
  Search,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type RowStatus = "ok" | "needs_review" | "not_found" | "new_product";

interface StagingRow {
  id: number;
  competitorCodeMaster: string | null;
  competitorCodeCatalogue: string | null;
  matchedPrayagCode: string | null;
  description: string | null;
  catalogueDescription: string | null;
  variant: string | null;
  oldMrp: number | null;
  newMrp: number | null;
  increasePct: number | null;
  prayagMrpCurrent: number | null;
  gapPct: number | null;
  page: number | null;
  matchMethod: string | null;
  status: RowStatus;
  reviewReason: string | null;
}

interface BatchData {
  id: number;
  competitor: string;
  effectiveDate: string;
  sourceFileName: string;
  priceBasis: string;
  gstPct: number | null;
  status: string;
  rowCounts: { ok: number; needs_review: number; not_found: number; new_products: number } | null;
  rows: StagingRow[];
}

function fmt(v: number | null, decimals = 0): string {
  if (v == null) return "—";
  return v.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function pctColor(pct: number | null, invert = false): string {
  if (pct == null) return "text-muted-foreground";
  const big = Math.abs(pct) > 10;
  if (invert) {
    return pct > 0 ? (big ? "text-red-600 font-semibold" : "text-red-500") : (big ? "text-green-600 font-semibold" : "text-green-500");
  }
  return pct > 0 ? (big ? "text-green-600 font-semibold" : "text-green-500") : (big ? "text-red-600 font-semibold" : "text-red-500");
}

function IncreaseChip({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-muted-foreground text-xs">—</span>;
  const label = `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
  const cls = pct > 10
    ? "bg-red-50 text-red-700 border border-red-200"
    : pct > 0
      ? "bg-amber-50 text-amber-700 border border-amber-200"
      : "bg-green-50 text-green-700 border border-green-200";
  return <span className={`inline-block text-xs px-1.5 py-0.5 rounded font-mono ${cls}`}>{label}</span>;
}

function GapChip({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-muted-foreground text-xs">—</span>;
  // Positive gap = competitor is cheaper than Prayag = bad for us
  const label = `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
  const cls = pct < -10
    ? "bg-green-50 text-green-700 border border-green-200"
    : pct < 0
      ? "bg-green-50 text-green-600 border border-green-100"
      : pct > 10
        ? "bg-red-50 text-red-700 border border-red-200"
        : "bg-amber-50 text-amber-700 border border-amber-100";
  return <span className={`inline-block text-xs px-1.5 py-0.5 rounded font-mono ${cls}`}>{label}</span>;
}

type TabKey = "needs_review" | "ok" | "not_found" | "new_product";

function RowCard({ row }: { row: StagingRow }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border rounded-lg bg-card overflow-hidden">
      <button
        className="w-full text-left flex items-start gap-3 p-4 hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded((p) => !p)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-medium">
              {row.competitorCodeCatalogue ?? row.competitorCodeMaster ?? "—"}
            </span>
            {row.variant && (
              <Badge variant="outline" className="text-xs">{row.variant}</Badge>
            )}
            {row.matchedPrayagCode && (
              <span className="text-xs text-muted-foreground font-mono">→ {row.matchedPrayagCode}</span>
            )}
            {row.page != null && (
              <span className="text-xs text-muted-foreground">p.{row.page}</span>
            )}
          </div>
          <div className="text-sm text-muted-foreground mt-0.5 truncate">
            {row.catalogueDescription ?? row.description ?? "—"}
          </div>
          {row.reviewReason && (
            <div className="text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded mt-1 border border-amber-200">
              ⚠ {row.reviewReason}
            </div>
          )}
        </div>

        <div className="flex items-center gap-4 shrink-0 text-right">
          <div>
            <div className="text-xs text-muted-foreground">Old → New MRP</div>
            <div className="font-mono text-sm">
              ₹{fmt(row.oldMrp)} → <span className="font-semibold">₹{fmt(row.newMrp)}</span>
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Increase</div>
            <IncreaseChip pct={row.increasePct} />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">vs Prayag</div>
            <GapChip pct={row.gapPct} />
          </div>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t bg-muted/20">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">Competitor Code (master)</div>
              <code className="font-mono">{row.competitorCodeMaster ?? "—"}</code>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">Competitor Code (catalogue)</div>
              <code className="font-mono">{row.competitorCodeCatalogue ?? "—"}</code>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">Prayag Code</div>
              <code className="font-mono">{row.matchedPrayagCode ?? "—"}</code>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">Expected Description</div>
              <span>{row.description ?? "—"}</span>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">Catalogue Description</div>
              <span>{row.catalogueDescription ?? "—"}</span>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">Prayag MRP (current)</div>
              <span className="font-mono">₹{fmt(row.prayagMrpCurrent)}</span>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">Match Method</div>
              <Badge variant="outline" className="text-xs">{row.matchMethod ?? "—"}</Badge>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">Page</div>
              <span>{row.page ?? "—"}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-12 flex flex-col items-center gap-2 text-muted-foreground border border-dashed rounded-lg">
      <Search className="w-6 h-6 opacity-40" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

export default function ImportReviewPage() {
  const params = useParams<{ id: string }>();
  const batchId = params.id;
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [batch, setBatch] = useState<BatchData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("needs_review");
  const [isApproving, setIsApproving] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Load batch on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${BASE}/api/catalog/import-batches/${batchId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load batch");
        setBatch(data);
        // Default to needs_review if there are any, otherwise ok
        if ((data.rowCounts?.needs_review ?? 0) > 0) {
          setActiveTab("needs_review");
        } else {
          setActiveTab("ok");
        }
      } catch (err: any) {
        setLoadError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [batchId]);

  const handleApprove = async () => {
    if (!batch) return;
    setIsApproving(true);
    try {
      const res = await fetch(`${BASE}/api/catalog/import-batches/${batchId}/approve`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Approve failed");
      toast({
        title: "Batch Approved",
        description: `${data.committed} price rows committed to ${batch.competitor}.`,
      });
      navigate("/import-competitor");
    } catch (err: any) {
      toast({ title: "Approve Failed", description: err.message, variant: "destructive" });
      setIsApproving(false);
    }
  };

  const handleDiscard = async () => {
    if (!batch) return;
    if (!confirm("Discard this batch? Staged prices will be deleted. The batch record is kept for audit.")) return;
    setIsDiscarding(true);
    try {
      const res = await fetch(`${BASE}/api/catalog/import-batches/${batchId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Discard failed");
      toast({ title: "Batch Discarded", description: "Staged rows have been removed." });
      navigate("/import-competitor");
    } catch (err: any) {
      toast({ title: "Discard Failed", description: err.message, variant: "destructive" });
      setIsDiscarding(false);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const res = await fetch(`${BASE}/api/catalog/import-batches/${batchId}/export`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const fname = disposition.match(/filename="([^"]+)"/)?.[1] ?? `review-${batchId}.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fname;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: "Export Failed", description: err.message, variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  // --- Render ---

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
        Loading import batch…
      </div>
    );
  }

  if (loadError || !batch) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-6 text-destructive">
          {loadError ?? "Batch not found"}
        </div>
      </div>
    );
  }

  const isAlreadyDone = batch.status !== "pending";

  const rowsByStatus = {
    needs_review: batch.rows.filter((r) => r.status === "needs_review"),
    ok: batch.rows.filter((r) => r.status === "ok"),
    not_found: batch.rows.filter((r) => r.status === "not_found"),
    new_product: batch.rows.filter((r) => r.status === "new_product"),
  } satisfies Record<TabKey, StagingRow[]>;

  const tabConfig: { key: TabKey; label: string; variant: string }[] = [
    { key: "needs_review", label: "Needs Review", variant: "amber" },
    { key: "ok",           label: "Ready",        variant: "green" },
    { key: "not_found",    label: "Not Found",    variant: "muted" },
    { key: "new_product",  label: "New Products", variant: "blue" },
  ];

  const tabBadgeClass: Record<string, string> = {
    amber: "bg-amber-100 text-amber-700 border border-amber-300",
    green: "bg-green-100 text-green-700 border border-green-300",
    muted: "bg-muted text-muted-foreground border",
    blue:  "bg-blue-100 text-blue-700 border border-blue-300",
  };

  const toApprove = rowsByStatus.ok.length + rowsByStatus.needs_review.length;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/import-competitor")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">
            Review Import — {batch.competitor}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {batch.sourceFileName} · w.e.f. {batch.effectiveDate} · Price basis:{" "}
            <span className="font-medium">{batch.priceBasis}{batch.gstPct != null ? ` + ${batch.gstPct}% GST` : ""}</span>
          </p>
        </div>
      </div>

      {/* Status banner if already done */}
      {isAlreadyDone && (
        <div className={`rounded-lg px-4 py-3 border text-sm font-medium ${
          batch.status === "approved"
            ? "bg-green-50 border-green-200 text-green-800"
            : "bg-muted border-border text-muted-foreground"
        }`}>
          This batch has been{" "}
          <span className="font-semibold">{batch.status}</span>.
          {batch.status === "approved" ? " Prices are live in the comparison dashboard." : ""}
        </div>
      )}

      {/* Count cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Ready",        count: batch.rowCounts?.ok ?? 0,          cls: "text-green-600" },
          { label: "Needs Review", count: batch.rowCounts?.needs_review ?? 0, cls: "text-amber-600" },
          { label: "Not Found",    count: batch.rowCounts?.not_found ?? 0,    cls: "text-muted-foreground" },
          { label: "New Products", count: batch.rowCounts?.new_products ?? 0, cls: "text-blue-600" },
        ].map(({ label, count, cls }) => (
          <div key={label} className="bg-card border rounded-lg p-4">
            <div className="text-xs text-muted-foreground mb-1">{label}</div>
            <div className={`text-3xl font-mono font-bold ${cls}`}>{count}</div>
          </div>
        ))}
      </div>

      {/* Action bar */}
      {!isAlreadyDone && (
        <div className="flex items-center gap-3 flex-wrap">
          <Button onClick={handleApprove} disabled={isApproving || isDiscarding || toApprove === 0} className="gap-2">
            {isApproving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Approve &amp; Commit ({toApprove} rows)
          </Button>
          <Button variant="outline" onClick={handleDiscard} disabled={isApproving || isDiscarding} className="gap-2 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30">
            {isDiscarding ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
            Discard Batch
          </Button>
          <Button variant="ghost" size="sm" onClick={handleExport} disabled={isExporting} className="gap-2 ml-auto">
            {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Export Excel
          </Button>
        </div>
      )}

      {batch.rowCounts?.needs_review && batch.rowCounts.needs_review > 0 && !isAlreadyDone && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex gap-3 items-start text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            <strong>{batch.rowCounts.needs_review} rows</strong> need your attention (code renumbering, size or description mismatch). They are included in the Approve count — review the reasons below before committing.
          </span>
        </div>
      )}

      {/* Tab bar */}
      <div className="border-b">
        <div className="flex gap-1">
          {tabConfig.map(({ key, label, variant }) => {
            const count = rowsByStatus[key].length;
            return (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px flex items-center gap-2 ${
                  activeTab === key
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted"
                }`}
              >
                {label}
                {count > 0 && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${tabBadgeClass[variant]}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="space-y-2">
        {activeTab === "needs_review" && (
          rowsByStatus.needs_review.length === 0 ? (
            <EmptyState message="No rows flagged for review — all code matches were clean." />
          ) : (
            rowsByStatus.needs_review.map((r) => <RowCard key={r.id} row={r} />)
          )
        )}
        {activeTab === "ok" && (
          rowsByStatus.ok.length === 0 ? (
            <EmptyState message="No clean matches in this batch." />
          ) : (
            rowsByStatus.ok.map((r) => <RowCard key={r.id} row={r} />)
          )
        )}
        {activeTab === "not_found" && (
          rowsByStatus.not_found.length === 0 ? (
            <EmptyState message="All mapped products were found in the catalogue." />
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground px-1">
                These products are in your existing mapping but were not found in the catalogue. Their current prices will remain unchanged.
              </p>
              {rowsByStatus.not_found.map((r) => (
                <div key={r.id} className="border rounded-lg p-4 bg-card flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm">{r.competitorCodeMaster ?? "—"}</span>
                      {r.matchedPrayagCode && (
                        <span className="text-xs text-muted-foreground font-mono">→ {r.matchedPrayagCode}</span>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground mt-0.5">{r.description ?? "—"}</div>
                    {r.reviewReason && (
                      <div className="text-xs text-muted-foreground mt-1">{r.reviewReason}</div>
                    )}
                  </div>
                  <div className="text-sm font-mono shrink-0">
                    <div className="text-xs text-muted-foreground">Current price</div>
                    ₹{fmt(r.oldMrp)}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
        {activeTab === "new_product" && (
          rowsByStatus.new_product.length === 0 ? (
            <EmptyState message="No new products found in this catalogue." />
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground px-1">
                These items were found in the catalogue but have no existing Prayag mapping. They are not committed on Approve — add them via Mapping Review if needed.
              </p>
              {rowsByStatus.new_product.map((r) => (
                <div key={r.id} className="border rounded-lg p-4 bg-card flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-medium">{r.competitorCodeCatalogue ?? "—"}</span>
                      {r.variant && <Badge variant="outline" className="text-xs">{r.variant}</Badge>}
                      {r.page != null && <span className="text-xs text-muted-foreground">p.{r.page}</span>}
                    </div>
                    <div className="text-sm text-muted-foreground mt-0.5">{r.catalogueDescription ?? "—"}</div>
                  </div>
                  <div className="text-sm font-mono shrink-0">
                    <div className="text-xs text-muted-foreground">MRP</div>
                    ₹{fmt(r.newMrp)}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* Bottom action bar (duplicate for long pages) */}
      {!isAlreadyDone && batch.rows.length > 6 && (
        <div className="flex items-center gap-3 flex-wrap pt-2 border-t">
          <Button onClick={handleApprove} disabled={isApproving || isDiscarding || toApprove === 0} className="gap-2">
            {isApproving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Approve &amp; Commit ({toApprove} rows)
          </Button>
          <Button variant="outline" onClick={handleDiscard} disabled={isApproving || isDiscarding} className="gap-2 text-destructive hover:text-destructive border-destructive/30">
            {isDiscarding ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
            Discard Batch
          </Button>
        </div>
      )}
    </div>
  );
}
