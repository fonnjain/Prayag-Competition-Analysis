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
import { formatMoney } from "@workspace/formatting";
import { useLocation, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { formatDisplayDate } from "@/lib/date-format";
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
  discoveryEvidence: string | null;
  adjudicated: boolean;
  matchMethod: string | null;
  status: RowStatus;
  reviewReason: string | null;
  /** Origin recorded by the staging API; local codes are internal handles. */
  codeSource?: "supplier" | "locally_assigned" | "unverified" | string | null;
  code_source?: "supplier" | "locally_assigned" | "unverified" | string | null;
}

interface BatchData {
  id: number;
  competitor: string;
  effectiveDate: string;
  sourceFileName: string;
  priceBasis: string;
  gstPct: number | null;
  status: string;
  fileSha256: string | null;
  fileSizeBytes: number | null;
  extractorVersion: string | null;
  catalogueProfileRevision: string | null;
  promptRevision: string | null;
  model: string | null;
  pagesRequested: string | null;
  passesRun: number | null;
  itemsAdjudicated: number | null;
  rowCounts: {
    source?: string;
    ok: number;
    needs_review: number;
    not_found: number;
    new_products: number;
    codes_found_both_passes?: number;
    codes_found_one_pass_only?: number;
    pages_adjudicated?: number[];
    items_adjudicated?: number;
    passes_run?: number;
    extractionPath?: "text" | "vision" | "text_then_ai";
    detectedClass?: "text" | "vision" | "uncertain";
    extractionOverride?: boolean;
    gstSanityWarning?: {
      previousMedianGap: number;
      currentMedianGap: number;
      shiftPoints: number;
      previousBasis: string | null;
      currentBasis: string;
      message?: string;
    } | null;
    duplicate?: { message?: string; action?: string; existingBatchId?: number | null };
    coverageGaps?: Record<string, number> | Array<{ category: string; count: number }> | null;
    coverage_gaps?: Record<string, number> | Array<{ category: string; count: number }> | null;
    coverageGapsByCategory?: Record<string, number> | null;
    unpricedCoverageGaps?: Record<string, number> | Array<{ category: string; count: number }> | null;
  } | null;
  rows?: StagingRow[];
  /** Apollo staged-load contract (present only for Apollo workbooks). */
  batchId?: number;
  contentFingerprint?: string;
  summary?: ApolloLoadSummaryData | null;
  undoWindowHours?: number;
  created?: number;
  updated?: number;
  unchanged?: number;
  restored?: number;
  deleted?: number;
  apolloRows?: ApolloLoadRow[];
}

interface ApolloLoadRow {
  competitorCode?: string | null;
  prayagCode?: string | null;
  description?: string | null;
  size?: string | null;
  codeSource?: string | null;
  oldPrice?: number | null;
  newPrice?: number | null;
  status?: string;
  reason?: string | null;
  evidence?: { kind?: string; reason?: string | null } | null;
}

interface ApolloLoadSummaryData {
  total?: number;
  accepted?: number;
  held?: number;
  create?: number;
  update?: number;
  unchanged?: number;
  reviewIssues?: number;
  notVerified?: number;
  conflicts?: Array<{ competitorCode?: string; reason?: string }>;
  unpriced?: unknown;
}

/** Bearer token stored by the auth layer — needed for raw fetch() calls that
 *  bypass the generated API client (which injects Authorization automatically). */
function getAuthHeaders(): Record<string, string> {
  try {
    const sid = localStorage.getItem("prayag_sid");
    if (sid) return { Authorization: `Bearer ${sid}` };
  } catch { /* ignore */ }
  return {};
}

function fmt(v: number | null): string {
  return formatMoney(v);
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

function discoveryLabel(row: StagingRow): string | null {
  if (!row.discoveryEvidence) return null;
  try {
    const evidence = JSON.parse(row.discoveryEvidence) as { foundInPasses?: number[]; finalPass?: number };
    if (!Array.isArray(evidence.foundInPasses) || evidence.foundInPasses.length === 0) return null;
    return `Found in read${evidence.foundInPasses.length === 1 ? "" : "s"} ${evidence.foundInPasses.join(", ")} · final read ${evidence.finalPass ?? "—"}`;
  } catch {
    return null;
  }
}

function codeSource(row: StagingRow): "supplier" | "locally_assigned" | "unverified" {
  const source = row.codeSource ?? row.code_source;
  if (source === "supplier" || source === "locally_assigned" || source === "unverified") return source;
  return "unverified";
}

function CodeOriginBadge({ row, competitor }: { row: StagingRow; competitor: string }) {
  const source = codeSource(row);
  const isApollo = competitor.trim().toLowerCase() === "apollo";
  const label = source === "locally_assigned"
    ? isApollo ? "Internal code · NOT Apollo SKU" : "Internal code · NOT supplier SKU"
    : source === "supplier"
      ? isApollo ? "Apollo SKU" : "Supplier code"
      : "Origin unverified";
  return (
    <Badge
      variant="outline"
      className={source === "locally_assigned"
        ? "text-xs border-orange-300 bg-orange-50 text-orange-800"
        : source === "unverified"
          ? "text-xs border-slate-300 bg-slate-50 text-slate-700"
          : "text-xs border-blue-300 bg-blue-50 text-blue-800"}
    >
      {label}
    </Badge>
  );
}

function CoverageGapSummary({ rowCounts }: { rowCounts: BatchData["rowCounts"] }) {
  const raw = rowCounts?.coverageGaps ?? rowCounts?.coverage_gaps ??
    rowCounts?.coverageGapsByCategory ?? rowCounts?.unpricedCoverageGaps;
  const gaps = Array.isArray(raw)
    ? [...raw.reduce((acc, gap) => {
        if (gap && typeof gap.category === "string" && gap.category.trim()) {
          acc.set(gap.category, (acc.get(gap.category) ?? 0) + (Number.isFinite(gap.count) ? gap.count : 1));
        }
        return acc;
      }, new Map<string, number>())].map(([category, count]) => ({ category, count }))
    : raw && typeof raw === "object"
      ? Object.entries(raw)
        .filter(([, count]) => Number.isFinite(count))
        .map(([category, count]) => ({ category, count: count as number }))
      : [];
  return (
    <section className="rounded-lg border bg-card p-4" data-testid="coverage-gaps">
      <h2 className="text-sm font-semibold">Unpriced coverage gaps</h2>
      {gaps.length > 0 ? (
        <>
          <p className="text-xs text-muted-foreground mt-1">
            Rows without a supplier price, reported by category. They are not imported as products.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {gaps.map(({ category, count }) => (
              <Badge key={category} variant="outline" className="font-mono">
                <span className="font-sans mr-1">{category}:</span>{count}
              </Badge>
            ))}
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground mt-1">
          Unpriced coverage gap counts unavailable in this import preview.
        </p>
      )}
    </section>
  );
}

type TabKey = "needs_review" | "ok" | "not_found" | "new_product";

function RowCard({ row, competitor }: { row: StagingRow; competitor: string }) {
  const [expanded, setExpanded] = useState(false);
  const discovery = discoveryLabel(row);
  return (
    <div className="border rounded-lg bg-card overflow-hidden">
      <button
        className="w-full text-left flex items-start gap-3 p-4 hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded((p) => !p)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-medium">
              {(codeSource(row) === "locally_assigned"
                ? row.competitorCodeMaster
                : row.competitorCodeCatalogue ?? row.competitorCodeMaster) ?? "—"}
            </span>
            <CodeOriginBadge row={row} competitor={competitor} />
            {row.variant && (
              <Badge variant="outline" className="text-xs">{row.variant}</Badge>
            )}
            {row.matchedPrayagCode && (
              <span className="text-xs text-muted-foreground font-mono">→ {row.matchedPrayagCode}</span>
            )}
            {row.page != null && (
              <span className="text-xs text-muted-foreground">p.{row.page}</span>
            )}
            {row.adjudicated && (
              <Badge className="text-xs bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-100">
                Adjudicated
              </Badge>
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
              {fmt(row.oldMrp)} → <span className="font-semibold">{fmt(row.newMrp)}</span>
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
              <div className="text-xs text-muted-foreground mb-0.5">
                {codeSource(row) === "locally_assigned" ? "Internal code (master)" : "Competitor code (master)"}
              </div>
              <code className="font-mono">{row.competitorCodeMaster ?? "—"}</code>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">
                {codeSource(row) === "locally_assigned" ? "Internal code (catalogue)" : "Competitor code (catalogue)"}
              </div>
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
              <span className="font-mono">{fmt(row.prayagMrpCurrent)}</span>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">Match Method</div>
              <Badge variant="outline" className="text-xs">{row.matchMethod ?? "—"}</Badge>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">Page</div>
              <span>{row.page ?? "—"}</span>
            </div>
            {discovery && (
              <div className="sm:col-span-2">
                <div className="text-xs text-muted-foreground mb-0.5">Discovery evidence</div>
                <span>{discovery}</span>
              </div>
            )}
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

function isApolloBatch(batch: BatchData): boolean {
  return Boolean(batch.contentFingerprint || batch.undoWindowHours != null || batch.summary);
}

function apolloCount(batch: BatchData, key: string): number {
  const summaryValue = (batch.summary as Record<string, unknown> | null | undefined)?.[key];
  const batchValue = key === "created"
    ? batch.created
    : key === "updated"
      ? batch.updated
      : key === "unchanged"
        ? batch.unchanged
        : key === "restored"
          ? batch.restored
          : key === "deleted"
            ? batch.deleted
            : undefined;
  const value = summaryValue ?? batchValue;
  if (typeof value === "number") return value;
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") {
    const count = (value as Record<string, unknown>).count ?? (value as Record<string, unknown>).total;
    if (typeof count === "number") return count;
    return Object.keys(value).length;
  }
  return 0;
}

function apolloRowCode(row: ApolloLoadRow): string {
  return row.competitorCode ?? "—";
}

function ApolloLoadSummary({ batch, isApplying, reason, onReasonChange, onApply, onUndo }: {
  batch: BatchData; isApplying: boolean; reason: string;
  onReasonChange: (value: string) => void; onApply: () => void; onUndo: () => void;
}) {
  const pending = batch.status === "pending";
  const applied = batch.status === "approved" || (batch.status !== "pending" && batch.created != null);
  const rows = batch.apolloRows ?? [];
  const heldRows = rows.filter((row) => row.status === "needs_review");
  const notVerifiedRows = rows.filter((row) => row.evidence?.kind?.toLowerCase() === "not-verified");
  const reviewIssues = [
    ...(batch.summary?.conflicts ?? []).filter(issue => issue.competitorCode).map(issue => ({
      code: issue.competitorCode!, label: "Unpriced / supplier price conflict",
    })),
    ...rows.filter(row => row.competitorCode && (row.evidence?.kind === "price-dispute" || row.evidence?.kind === "product-identity-dispute"))
      .map(row => ({
        code: row.competitorCode!,
        label: row.evidence?.kind === "price-dispute" ? "Price dispute" : "Product identity dispute",
      })),
  ];
  const countCards = [
    ["Total", apolloCount(batch, "total")],
    ["Accepted", apolloCount(batch, "accepted")],
    ["Held", apolloCount(batch, "held")],
    ["Create", apolloCount(batch, "create")],
    ["Update", apolloCount(batch, "update")],
    ["Unchanged", apolloCount(batch, "unchanged")],
    ["Review issues", apolloCount(batch, "reviewIssues")],
    ["Not verified", apolloCount(batch, "notVerified")],
    ["Conflicts", apolloCount(batch, "conflicts")],
    ["Unpriced", apolloCount(batch, "unpriced")],
  ];
  return (
    <section className="rounded-lg border border-blue-200 bg-blue-50 p-5 space-y-4" data-testid="apollo-load-summary">
      <div>
        <h2 className="font-semibold text-blue-950">Apollo staged load</h2>
        <p className="text-sm text-blue-900 mt-1">No Prayag products or prices, and no other brands, change until an administrator applies this reviewed fingerprint.</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3" data-testid="apollo-review-counts">
        {countCards.map(([label, count]) => (
          <div key={label} className="rounded border bg-white/70 p-3" data-testid={`apollo-count-${String(label).toLowerCase().replace(/\s+/g, "-")}`}>
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-2xl font-mono font-bold">{count}</div>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-2" data-testid="apollo-review-issues">
        <h3 className="text-sm font-semibold text-amber-950">Flagged review issues</h3>
        <ul className="space-y-1 text-sm text-amber-950">
          {reviewIssues.map(({ code, label }) => (
            <li key={code} className="flex flex-wrap gap-x-2" data-testid={`apollo-issue-${code}`}>
              <code className="font-mono font-semibold">{code}</code><span>— {label}</span>
            </li>
          ))}
          {reviewIssues.length === 0 && <li>No flagged issues in this preview.</li>}
        </ul>
      </div>
      <div className="space-y-2" data-testid="apollo-held-rows">
        <h3 className="text-sm font-semibold text-blue-950">Held rows ({heldRows.length})</h3>
        {heldRows.length > 0 ? heldRows.map((row, index) => (
          <div key={`${apolloRowCode(row)}-${index}`} className="rounded border bg-white/70 px-3 py-2 text-sm" data-testid={`apollo-held-row-${index}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">Competitor SKU</span>
                <span className="font-mono font-semibold">{apolloRowCode(row)}</span>
                {row.codeSource && <Badge variant="outline" className="text-xs">{row.codeSource}</Badge>}
                {row.prayagCode && <span className="text-xs text-muted-foreground font-mono">→ {row.prayagCode}</span>}
              </div>
              <span className="text-xs uppercase text-amber-800">{row.status}</span>
            </div>
            {(row.description || row.size) && <p className="mt-1 text-xs text-muted-foreground">{[row.description, row.size].filter(Boolean).join(" · ")}</p>}
            <div className="mt-1 flex flex-wrap justify-between gap-2">
              <p className="text-xs text-amber-900">{row.reason || "Held for review; no reason supplied."}</p>
              {(row.oldPrice != null || row.newPrice != null) && (
                <span className="text-xs font-mono text-muted-foreground">Old → New: {fmt(row.oldPrice ?? null)} → {fmt(row.newPrice ?? null)}</span>
              )}
            </div>
          </div>
        )) : (
          <p className="text-sm text-muted-foreground">Held-row details were not returned in the Apollo preview.</p>
        )}
      </div>
      <div className="space-y-2" data-testid="apollo-not-verified-markers">
        <h3 className="text-sm font-semibold text-blue-950">Not verified ({apolloCount(batch, "notVerified")})</h3>
        <div className="flex flex-wrap gap-2">
          {notVerifiedRows.map((row, index) => (
            <Badge key={`${apolloRowCode(row)}-${index}`} variant="outline" className="border-slate-300 bg-white text-slate-700" data-testid={`apollo-not-verified-${index}`}>
              Not verified · <span className="font-mono ml-1">{apolloRowCode(row)}</span>
            </Badge>
          ))}
          {notVerifiedRows.length === 0 && apolloCount(batch, "notVerified") > 0 && (
            <Badge variant="outline" className="border-slate-300 bg-white text-slate-700">Not verified markers are included in the count; row details are unavailable.</Badge>
          )}
        </div>
      </div>
      <p className="text-xs font-mono break-all text-blue-950">Content fingerprint: {batch.contentFingerprint ?? "unavailable"}</p>
      {pending && <div className="flex items-center gap-3 flex-wrap"><Button onClick={onApply} disabled={isApplying || !batch.contentFingerprint} className="gap-2">{isApplying && <Loader2 className="w-4 h-4 animate-spin" />}Admin Apply Apollo Load</Button><span className="text-xs text-blue-900">Applying requires this exact reviewed fingerprint.</span></div>}
      {applied && <div className="space-y-3 border-t border-blue-200 pt-3"><p className="text-sm font-medium text-blue-950">Applied. Undo is available for {batch.undoWindowHours ?? 24} hours.</p><div className="flex gap-2"><Input aria-label="Apollo undo reason" placeholder="Reason for undo" value={reason} onChange={(event) => onReasonChange(event.target.value)} /><Button variant="outline" onClick={onUndo} disabled={isApplying}>Undo load</Button></div></div>}
    </section>
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
  const [apolloReason, setApolloReason] = useState("");
  const [failedChunks, setFailedChunks] = useState<
    Array<{ chunkIndex: number; startPage: number; endPage: number }>
  >([]);

  // Read failed chunks from sessionStorage (written by the import page after SSE completes)
  useEffect(() => {
    if (!batchId) return;
    const key = `importBatch_${batchId}_failedChunks`;
    const raw = sessionStorage.getItem(key);
    if (raw) {
      try {
        setFailedChunks(JSON.parse(raw));
      } catch {
        // ignore malformed data
      }
      sessionStorage.removeItem(key);
    }
  }, [batchId]);

  // Load batch on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/catalog/import-batches/${batchId}`, {
          headers: getAuthHeaders(),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load batch");
        // The generic route is the durable discovery point for an import-review
        // URL. Apollo batches advertise their source there, but the Apollo GET
        // is authoritative for the fingerprint, staged rows, and undo status.
        let authoritative = data;
        if (data.rowCounts?.source === "apollo_staged_load") {
          const apolloRes = await fetch(`/api/catalog/apollo-load/${batchId}`, {
            headers: getAuthHeaders(),
          });
          const apolloData = await apolloRes.json().catch(() => ({}));
          if (!apolloRes.ok) throw new Error(apolloData.error || "Could not load the authoritative Apollo preview.");
          authoritative = {
            ...apolloData,
            competitor: "Apollo",
            status: apolloData.status ?? "pending",
            rows: apolloData.rows ?? [],
            apolloRows: Array.isArray(apolloData.rows) ? apolloData.rows : [],
          };
        }
        setBatch(authoritative);
        // Default to needs_review if there are any, otherwise ok
        if ((authoritative.rowCounts?.needs_review ?? 0) > 0) {
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
      if (isApolloBatch(batch)) {
        const res = await fetch(`/api/catalog/apollo-load/${batchId}/apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ contentFingerprint: batch.contentFingerprint }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 409) throw new Error(data.error || "This Apollo preview is stale. Reload the preview; no prices were changed.");
        if (!res.ok) throw new Error(data.error || "Apollo apply failed. No prices were changed.");
        setBatch({ ...batch, ...data, status: "approved" });
        toast({ title: "Apollo Load Applied", description: `${data.created ?? 0} created, ${data.updated ?? 0} updated, ${data.unchanged ?? 0} unchanged.` });
        return;
      }
      const res = await fetch(`/api/catalog/import-batches/${batchId}/approve`, {
        method: "POST",
        headers: getAuthHeaders(),
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

  const handleApolloUndo = async () => {
    if (!batch || !apolloReason.trim()) {
      toast({ title: "Undo reason required", description: "Explain why this Apollo load is being undone.", variant: "destructive" });
      return;
    }
    setIsApproving(true);
    try {
      const res = await fetch(`/api/catalog/apollo-load/${batchId}/undo`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ reason: apolloReason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Apollo undo refused.");
      setBatch({ ...batch, ...data, status: "undone" });
      toast({ title: "Apollo Load Undone", description: `${data.restored ?? 0} restored and ${data.deleted ?? 0} deleted.` });
    } catch (err: any) {
      toast({ title: "Undo Refused", description: err.message, variant: "destructive" });
    } finally {
      setIsApproving(false);
    }
  };

  const handleDiscard = async () => {
    if (!batch) return;
    if (!confirm("Discard this batch? Staged prices will be deleted. The batch record is kept for audit.")) return;
    setIsDiscarding(true);
    try {
      const res = await fetch(`/api/catalog/import-batches/${batchId}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
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
      const res = await fetch(`/api/catalog/import-batches/${batchId}/export`, {
        headers: getAuthHeaders(),
      });
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
  const apolloBatch = isApolloBatch(batch);

  const rowsByStatus = {
    needs_review: (batch.rows ?? []).filter((r) => r.status === "needs_review"),
    ok: (batch.rows ?? []).filter((r) => r.status === "ok"),
    not_found: (batch.rows ?? []).filter((r) => r.status === "not_found"),
    new_product: (batch.rows ?? []).filter((r) => r.status === "new_product"),
  } satisfies Record<TabKey, StagingRow[]>;

  const isApollo = apolloBatch || batch.competitor?.trim().toLowerCase() === "apollo";
  const tabConfig: { key: TabKey; label: string; variant: string }[] = [
    { key: "needs_review", label: "Needs Review", variant: "amber" },
    { key: "ok",           label: "Ready",        variant: "green" },
    { key: "not_found",    label: "Not Found",    variant: "muted" },
    ...(!isApollo ? [{ key: "new_product" as TabKey, label: "New Products", variant: "blue" }] : []),
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
      <div className="flex items-start">
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">
            Review Import — {apolloBatch ? "Apollo" : batch.competitor}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {apolloBatch ? "Apollo workbook preview" : <>{batch.sourceFileName} · w.e.f. {formatDisplayDate(batch.effectiveDate)} · Price basis:{" "}
            <span className="font-medium">{batch.priceBasis}{batch.gstPct != null ? ` + ${batch.gstPct}% GST` : ""}</span></>}
          </p>
          {(batch.fileSha256 || batch.model || batch.extractorVersion) && (
            <p className="text-xs text-muted-foreground mt-1">
              {batch.fileSha256 ? `SHA-256 ${batch.fileSha256.slice(0, 12)}…` : "Source hash unavailable"}{" "}
              · {batch.model ?? batch.extractorVersion ?? "Extractor metadata unavailable"}
              {batch.catalogueProfileRevision ? ` · profile ${batch.catalogueProfileRevision}` : ""}
            </p>
          )}
        </div>
      </div>

      {apolloBatch && (
        <ApolloLoadSummary
          batch={batch}
          isApplying={isApproving}
          reason={apolloReason}
          onReasonChange={setApolloReason}
          onApply={handleApprove}
          onUndo={handleApolloUndo}
        />
      )}

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
      {!isAlreadyDone && !apolloBatch && (
        <div className="rounded-lg px-4 py-3 border border-amber-300 bg-amber-50 text-sm text-amber-900">
          <strong>Pending review — prices are not live.</strong> Inspect the staged rows below, then use
          {" "}Commit Prices to write the approved rows to the competitor price list.
        </div>
      )}
      {batch.rowCounts?.gstSanityWarning && (
        <div className="rounded-lg border-2 border-red-400 bg-red-50 px-4 py-3 text-sm text-red-900" data-testid="gst-sanity-warning">
          <strong>GST sanity warning — review before committing.</strong>{" "}
          Median business gap moved from {batch.rowCounts.gstSanityWarning.previousMedianGap.toFixed(1)}% to{" "}
          {batch.rowCounts.gstSanityWarning.currentMedianGap.toFixed(1)}% ({batch.rowCounts.gstSanityWarning.shiftPoints > 0 ? "+" : ""}
          {batch.rowCounts.gstSanityWarning.shiftPoints.toFixed(1)} points).
          Basis: previous {batch.rowCounts.gstSanityWarning.previousBasis ?? "unknown"}, current {batch.rowCounts.gstSanityWarning.currentBasis}.
          No automatic approval will occur.
        </div>
      )}

      {/* Failed-chunks warning */}
      {failedChunks.length > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg px-4 py-3 flex gap-3 items-start text-sm text-amber-900">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
          <div className="space-y-1">
            <p className="font-semibold">
              {failedChunks.length === 1 ? "1 page range" : `${failedChunks.length} page ranges`} could not be read from the PDF
            </p>
            <ul className="list-disc list-inside space-y-0.5 text-amber-800">
              {failedChunks.map((fc) => (
                <li key={fc.chunkIndex}>
                  Pages {fc.startPage}–{fc.endPage} — consider re-uploading or checking those pages in the original PDF
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {!apolloBatch && <>
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
              {label === "New Products" && batch.rowCounts && (
                <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  <div>{batch.rowCounts.codes_found_both_passes ?? "—"} found by both reads</div>
                  <div className={(batch.rowCounts.codes_found_one_pass_only ?? 0) > 0 ? "text-amber-700 font-medium" : ""}>
                    {batch.rowCounts.codes_found_one_pass_only ?? "—"} one-pass-only
                  </div>
                  <div>{batch.rowCounts.items_adjudicated ?? batch.itemsAdjudicated ?? 0} adjudicated</div>
                </div>
              )}
          </div>
        ))}
      </div>

      <CoverageGapSummary rowCounts={batch.rowCounts} />

        {((batch.rowCounts?.codes_found_one_pass_only ?? 0) > 0 || (batch.rowCounts?.items_adjudicated ?? 0) > 0) && (
          <div className="bg-amber-50 border border-amber-300 rounded-lg px-4 py-3 text-sm text-amber-900">
            <strong>Discovery disagreement detected.</strong>{" "}
            {batch.rowCounts?.codes_found_one_pass_only ?? 0} codes appeared in only one initial read;{" "}
            {batch.rowCounts?.items_adjudicated ?? 0} final rows were selected from an adjudication read.
            {(batch.rowCounts?.pages_adjudicated?.length ?? 0) > 0 && (
              <> Pages re-read: {batch.rowCounts!.pages_adjudicated!.join(", ")}.</>
            )}
          </div>
        )}
      </>}

      {/* Action bar */}
      {!isAlreadyDone && !apolloBatch && (
        <div className="flex items-center gap-3 flex-wrap">
          <Button onClick={handleApprove} disabled={isApproving || isDiscarding || toApprove === 0} className="gap-2" data-activity="competitor_import.approve">
            {isApproving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Commit Prices ({toApprove} rows)
          </Button>
          <Button variant="outline" onClick={handleDiscard} disabled={isApproving || isDiscarding} className="gap-2 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30" data-activity="competitor_import.discard">
            {isDiscarding ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
            Discard Batch
          </Button>
          <Button variant="ghost" size="sm" onClick={handleExport} disabled={isExporting} className="gap-2 ml-auto">
            {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Export Excel
          </Button>
        </div>
      )}

      {batch.rowCounts?.needs_review && batch.rowCounts.needs_review > 0 && !isAlreadyDone && !apolloBatch && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex gap-3 items-start text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            <strong>{batch.rowCounts.needs_review} rows</strong> need your attention (code renumbering, size or description mismatch). They are included in the Approve count — review the reasons below before committing.
          </span>
        </div>
      )}

      {!apolloBatch && <>
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
            rowsByStatus.needs_review.map((r) => <RowCard key={r.id} row={r} competitor={batch.competitor} />)
          )
        )}
        {activeTab === "ok" && (
          rowsByStatus.ok.length === 0 ? (
            <EmptyState message="No clean matches in this batch." />
          ) : (
            rowsByStatus.ok.map((r) => <RowCard key={r.id} row={r} competitor={batch.competitor} />)
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
                        <CodeOriginBadge row={r} competitor={batch.competitor} />
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
                    {fmt(r.oldMrp)}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
        {activeTab === "new_product" && !isApollo && (
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
                      <CodeOriginBadge row={r} competitor={batch.competitor} />
                      {r.variant && <Badge variant="outline" className="text-xs">{r.variant}</Badge>}
                      {r.page != null && <span className="text-xs text-muted-foreground">p.{r.page}</span>}
                    </div>
                    <div className="text-sm text-muted-foreground mt-0.5">{r.catalogueDescription ?? "—"}</div>
                  </div>
                  <div className="text-sm font-mono shrink-0">
                    <div className="text-xs text-muted-foreground">MRP</div>
                    {fmt(r.newMrp)}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
      </>}

      {/* Bottom action bar (duplicate for long pages) */}
      {!isAlreadyDone && !apolloBatch && (batch.rows ?? []).length > 6 && (
        <div className="flex items-center gap-3 flex-wrap pt-2 border-t">
          <Button onClick={handleApprove} disabled={isApproving || isDiscarding || toApprove === 0} className="gap-2" data-activity="competitor_import.approve">
            {isApproving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Commit Prices ({toApprove} rows)
          </Button>
          <Button variant="outline" onClick={handleDiscard} disabled={isApproving || isDiscarding} className="gap-2 text-destructive hover:text-destructive border-destructive/30" data-activity="competitor_import.discard">
            {isDiscarding ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
            Discard Batch
          </Button>
        </div>
      )}
    </div>
  );
}
