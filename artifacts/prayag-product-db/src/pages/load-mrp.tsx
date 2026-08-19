import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle, Calendar, ChevronDown, ChevronRight, Download, FileSpreadsheet, Trash2, Upload } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGetCatalogProductsQueryKey,
  getGetCatalogDataHealthQueryKey,
  getGetCatalogFiltersQueryKey,
  getGetComparisonQueryKey,
  getGetComparisonSummaryQueryKey,
  getGetComparisonByProductQueryKey,
} from "@workspace/api-client-react";

interface MrpPeriod {
  effectiveDate: string;
  count: number;
}

interface MrpSource {
  id: number;
  division: string;
  sheetUrl: string;
  expectedFileName: string | null;
  notes: string | null;
}

interface DuplicateSnapshot {
  sourceDivision: string;
  loadedAt: string;
  downloadedAt: string;
  fileSha256: string;
  loadBatchId: number;
}

function useMrpPeriods() {
  return useQuery<MrpPeriod[]>({
    queryKey: ["catalog", "mrp-periods"],
    queryFn: async () => {
      const res = await fetch("/api/catalog/mrp-periods");
      if (!res.ok) throw new Error("Failed to load MRP periods");
      const data = await res.json();
      return data.periods as MrpPeriod[];
    },
  });
}

function useMrpSources() {
  return useQuery<MrpSource[]>({
    queryKey: ["catalog", "mrp-sources"],
    queryFn: async () => {
      const res = await fetch("/api/catalog/mrp-sources");
      if (!res.ok) throw new Error("Failed to load official MRP sources");
      const data = await res.json();
      return data.sources as MrpSource[];
    },
  });
}

export default function LoadMrpPage() {
  const [file, setFile] = useState<File | null>(null);
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().split('T')[0]);
  const [sourceId, setSourceId] = useState("");
  const [downloadedAt, setDownloadedAt] = useState(new Date().toISOString().split("T")[0]);
  const [isUploading, setIsUploading] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [reviewFeedback, setReviewFeedback] = useState<string | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  // Tracks which low-MRP warnings the user has dismissed. "__single__" is the
  // sentinel key for single-file uploads; ZIP entries use their filename.
  const [dismissedLowMrp, setDismissedLowMrp] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<MrpPeriod | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [duplicateSnapshot, setDuplicateSnapshot] = useState<DuplicateSnapshot | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: periods, isLoading: periodsLoading } = useMrpPeriods();
  const { data: sources, isLoading: sourcesLoading } = useMrpSources();
  const selectedSource = sources?.find((source) => String(source.id) === sourceId) ?? null;

  const submitUpload = async (confirmDuplicate = false) => {
    if (!file || !effectiveDate || !sourceId || !downloadedAt) return;

    setIsUploading(true);
    setResult(null);
    setReviewFeedback(null);
    setDismissedLowMrp(new Set());

    const formData = new FormData();
    formData.append("file", file);
    formData.append("effectiveDate", effectiveDate);
    formData.append("sourceId", sourceId);
    formData.append("downloadedAt", downloadedAt);
    if (confirmDuplicate) formData.append("confirmDuplicate", "true");

    try {
      const res = await fetch("/api/catalog/load-mrp", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (res.status === 409 && data.duplicate) {
        setDuplicateSnapshot(data.duplicate as DuplicateSnapshot);
        return;
      }
      if (!res.ok) {
        throw new Error(data.error || "Failed to upload file");
      }

      setResult(data.results);
      toast({
        title:
          data.results.kind === "discontinuation-correction"
            ? "Correction applied"
            : data.results.flaggedMrpCount > 0
            ? "Review required"
            : "Upload successful",
        description:
          data.results.kind === "discontinuation-correction"
            ? data.results.message
            : data.results.flaggedMrpCount > 0
            ? `${data.results.flaggedMrpCount} suspicious price row(s) are blocked until you confirm them.`
            : `Imported ${data.results.totalRows} rows successfully.`,
      });
      // Invalidate catalog and comparison queries so new prices show immediately.
      queryClient.invalidateQueries({ queryKey: getGetCatalogProductsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetCatalogDataHealthQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetCatalogFiltersQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetComparisonQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetComparisonSummaryQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetComparisonByProductQueryKey() });
      queryClient.invalidateQueries({ queryKey: ["catalog", "mrp-periods"] });

    } catch (err: any) {
      toast({
        title: "Upload Failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitUpload();
  };

  const handleReview = async (decision: "approve" | "cancel") => {
    if (!result?.reviewBatchId) return;
    setIsReviewing(true);
    try {
      const res = await fetch(
        `/api/catalog/mrp-review-batches/${result.reviewBatchId}/${decision}`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not complete review");
      toast({
        title: decision === "approve" ? "Flagged prices approved" : "Flagged prices cancelled",
        description:
          decision === "approve"
            ? `${data.approved} reviewed price row(s) can now become current on their effective date.`
            : `${data.cancelled} flagged price row(s) were removed.`,
      });
      setReviewFeedback(
        decision === "approve"
          ? `${data.approved} reviewed price row(s) approved.`
          : `${data.cancelled} flagged price row(s) cancelled and removed.`,
      );
      setResult((current: any) => ({
        ...current,
        flaggedMrpCount: 0,
        flaggedRows: [],
        reviewBatchId: null,
      }));
      queryClient.invalidateQueries({ queryKey: getGetCatalogProductsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetCatalogDataHealthQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetComparisonQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetComparisonSummaryQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetComparisonByProductQueryKey() });
    } catch (err: any) {
      toast({
        title: "Review failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsReviewing(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!pendingDelete) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/catalog/mrp-period/${pendingDelete.effectiveDate}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to delete period");
      }
      toast({
        title: "Period Deleted",
        description: `Removed all MRP prices for ${pendingDelete.effectiveDate}.`,
      });
      queryClient.invalidateQueries({ queryKey: ["catalog", "mrp-periods"] });
      queryClient.invalidateQueries({ queryKey: getGetCatalogProductsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetCatalogDataHealthQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetCatalogFiltersQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetComparisonQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetComparisonSummaryQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetComparisonByProductQueryKey() });
    } catch (err: any) {
      toast({
        title: "Delete Failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
      setPendingDelete(null);
    }
  };

  const handleDownloadUnmatched = () => {
    if (!result?.unmatchedCodes?.length) return;
    const lines = ["Item Code", ...result.unmatchedCodes].join("\n");
    const blob = new Blob([lines], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "unmatched-codes.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const nothingImported =
    result &&
    result.matchedProducts === 0 &&
    result.newProducts === 0 &&
    result.totalRows === 0;

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Load MRP Sheet</h1>
        <p className="text-muted-foreground mt-2">
          Upload a new price sheet to append to the historical ledger. Old prices are never overwritten.
        </p>
      </div>

      {/* Existing MRP Periods */}
      <div className="bg-card border rounded-lg p-6 space-y-4">
        <h2 className="font-semibold text-base flex items-center gap-2">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          Existing MRP Periods
        </h2>
        {periodsLoading ? (
          <p className="text-sm text-muted-foreground">Loading periods…</p>
        ) : !periods || periods.length === 0 ? (
          <p className="text-sm text-muted-foreground">No MRP periods loaded yet.</p>
        ) : (
          <div className="divide-y rounded-md border overflow-hidden">
            {periods.map((period) => (
              <div
                key={period.effectiveDate}
                className="flex items-center justify-between px-3 py-2.5 bg-muted/20 hover:bg-muted/40 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm font-medium">{period.effectiveDate}</span>
                  <span className="text-xs text-muted-foreground">
                    {period.count.toLocaleString()} item{period.count !== 1 ? "s" : ""}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                  disabled={periods.length <= 1}
                  title={
                    periods.length <= 1
                      ? "Cannot delete the only remaining period"
                      : `Delete all prices for ${period.effectiveDate}`
                  }
                  onClick={() => setPendingDelete(period)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
        {periods && periods.length === 1 && (
          <p className="text-xs text-muted-foreground">
            At least one period must remain — upload a replacement before deleting this one.
          </p>
        )}
      </div>

      {/* Upload Form */}
      <div className="bg-card border rounded-lg p-6">
        <form onSubmit={handleUpload} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="file">Price Sheet (Excel / CSV / ZIP)</Label>
            <Input 
              id="file" 
              type="file" 
              accept=".xlsx,.xls,.csv,.zip" 
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              required
            />
            <p className="text-xs text-muted-foreground">
              Upload a single Excel/CSV file, or a ZIP containing multiple spreadsheets. All files in the ZIP will use the same effective date.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="source">Official source</Label>
            <Select value={sourceId} onValueChange={setSourceId} disabled={sourcesLoading}>
              <SelectTrigger id="source">
                <SelectValue placeholder={sourcesLoading ? "Loading sources…" : "Choose the Google Sheet this file came from"} />
              </SelectTrigger>
              <SelectContent>
                {(sources ?? []).map((source) => (
                  <SelectItem key={source.id} value={String(source.id)}>
                    {source.division}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedSource && (
              <p className="text-xs text-muted-foreground">
                <a
                  href={selectedSource.sheetUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline font-medium"
                >
                  Open source sheet
                </a>
                {selectedSource.expectedFileName
                  ? ` · Expected file: ${selectedSource.expectedFileName}`
                  : ""}
              </p>
            )}
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="downloadedAt">File Downloaded On</Label>
            <Input
              id="downloadedAt"
              type="date"
              value={downloadedAt}
              onChange={(e) => setDownloadedAt(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">
              Enter when this copy was exported from the source sheet. This is not inferred from the file’s modified date.
            </p>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="effectiveDate">Effective Date</Label>
            <Input 
              id="effectiveDate" 
              type="date" 
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              required
            />
          </div>

          <Button type="submit" disabled={!file || !effectiveDate || !sourceId || !downloadedAt || isUploading} className="w-full">
            {isUploading ? (
              "Uploading..."
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                Process Upload
              </>
            )}
          </Button>
        </form>
      </div>

      {reviewFeedback && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900"
        >
          {reviewFeedback}
        </div>
      )}

      {result && (
        <div className="bg-card border rounded-lg p-6 space-y-4">
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-primary" />
            Import Summary
            {result.files && (
              <span className="text-sm font-normal text-muted-foreground">
                — {result.files.length} file{result.files.length !== 1 ? "s" : ""} from ZIP
              </span>
            )}
          </h3>
            {result.provenance && (
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                <div className="font-medium">{result.provenance.sourceDivision}</div>
                <div className="mt-1 text-muted-foreground">
                  Snapshot downloaded {result.provenance.downloadedAt} · SHA-256{" "}
                  <code className="font-mono text-xs">{result.provenance.fileSha256}</code>
                </div>
              </div>
            )}

          {/* Aggregate detection details — only for single-file uploads */}
          {!result.files && (
            <div className="text-sm grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="bg-muted/40 rounded px-3 py-2">
                <span className="text-muted-foreground">Code column: </span>
                <span className="font-medium">
                  {result.codeColHeader ? (
                    <code className="bg-muted px-1 rounded">{result.codeColHeader}</code>
                  ) : (
                    <span className="text-destructive">Not detected</span>
                  )}
                </span>
              </div>
              <div className="bg-muted/40 rounded px-3 py-2">
                <span className="text-muted-foreground">Price column: </span>
                <span className="font-medium">
                  {result.priceColHeader ? (
                    <code className="bg-muted px-1 rounded">{result.priceColHeader}</code>
                  ) : (
                    <span className="text-destructive">Not detected</span>
                  )}
                </span>
              </div>
              <div className="bg-muted/40 rounded px-3 py-2">
                <span className="text-muted-foreground">Basis: </span>
                <span className="font-medium">{result.basis || "—"}</span>
              </div>
            </div>
          )}

          {/* Aggregate counts */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="p-4 bg-muted/50 rounded-md">
              <div className="text-sm text-muted-foreground mb-1">Total Rows</div>
              <div className="text-2xl font-mono font-bold">{result.totalRows}</div>
            </div>
            <div className="p-4 bg-muted/50 rounded-md">
              <div className="text-sm text-muted-foreground mb-1">Matched</div>
              <div className="text-2xl font-mono font-bold text-green-600">{result.matchedProducts}</div>
            </div>
            <div className="p-4 bg-muted/50 rounded-md">
              <div className="text-sm text-muted-foreground mb-1">New Products</div>
              <div className="text-2xl font-mono font-bold">{result.newProducts}</div>
            </div>
            <div className="p-4 bg-muted/50 rounded-md">
              <div className="text-sm text-muted-foreground mb-1">New Prices</div>
              <div className="text-2xl font-mono font-bold text-primary">{result.newHistoryRows}</div>
            </div>
          </div>

          {result.flaggedMrpCount > 0 && result.reviewBatchId && (
            <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-4 text-amber-950 space-y-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                <div>
                  <h4 className="font-semibold">Price review required before these rows can go live</h4>
                  <p className="mt-1 text-sm">
                    {result.flaggedMrpCount} suspicious row{result.flaggedMrpCount !== 1 ? "s are" : " is"} blocked from current pricing. Compare the old and new values, then approve or cancel them.
                  </p>
                </div>
              </div>
              <div className="overflow-x-auto rounded-md border border-amber-300 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-amber-100 text-left">
                    <tr>
                      <th className="px-3 py-2">Item code</th>
                      <th className="px-3 py-2 text-right">Old MRP</th>
                      <th className="px-3 py-2 text-right">New MRP</th>
                      <th className="px-3 py-2">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(result.flaggedRows ?? []).map((row: any) => (
                      <tr key={row.itemCode} className="border-t border-amber-200">
                        <td className="px-3 py-2 font-mono font-semibold">{row.itemCode}</td>
                        <td className="px-3 py-2 text-right font-mono">
                          {row.oldMrp == null ? "No prior MRP" : `₹${Number(row.oldMrp).toFixed(2)}`}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold">
                          ₹{Number(row.newMrp).toFixed(2)}
                        </td>
                        <td className="px-3 py-2">{row.reasons.join("; ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isReviewing}
                  onClick={() => handleReview("cancel")}
                >
                  Cancel flagged rows
                </Button>
                <Button
                  type="button"
                  disabled={isReviewing}
                  onClick={() => handleReview("approve")}
                >
                  {isReviewing ? "Saving review…" : "Confirm flagged prices"}
                </Button>
              </div>
            </div>
          )}

          {/* Per-file breakdown for ZIP uploads */}
          {result.files && result.files.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Per-file breakdown</p>

              {/* Aggregate low-MRP warning for ZIP — visible without expanding any file */}
              {(() => {
                const affected = (result.files as any[]).filter(
                  (f) => f.lowMrpCount > 0 && !dismissedLowMrp.has("__zip__")
                );
                if (affected.length === 0) return null;
                const totalLow = affected.reduce((s: number, f: any) => s + f.lowMrpCount, 0);
                return (
                  <div className="flex items-start gap-3 text-sm text-amber-800 bg-amber-50 border border-amber-300 p-3 rounded">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
                    <div className="flex-1">
                      <p className="font-semibold">
                        ⚠ {totalLow} item{totalLow !== 1 ? "s" : ""} across {affected.length} file{affected.length !== 1 ? "s" : ""} have MRP below ₹50 — verify the correct price column was picked.
                      </p>
                      <p className="mt-1 text-xs">
                        Affected: {affected.map((f: any) => f.file).join(", ")}. Expand each file for details.
                      </p>
                    </div>
                    <button
                      onClick={() => setDismissedLowMrp((prev) => new Set([...prev, "__zip__"]))}
                      className="shrink-0 text-amber-600 hover:text-amber-800 text-lg leading-none font-bold"
                      aria-label="Dismiss warning"
                    >
                      ×
                    </button>
                  </div>
                );
              })()}

              {result.files.map((f: any) => {
                const isExpanded = expandedFiles.has(f.file);
                const toggle = () =>
                  setExpandedFiles((prev) => {
                    const next = new Set(prev);
                    isExpanded ? next.delete(f.file) : next.add(f.file);
                    return next;
                  });
                const noRows = f.totalRows === 0;
                const hasLowMrp = f.lowMrpCount > 0 && !dismissedLowMrp.has(f.file);
                return (
                  <div key={f.file} className="border rounded text-sm">
                    <button
                      onClick={toggle}
                      className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/40 transition-colors text-left"
                    >
                      <span className="flex items-center gap-2 font-medium truncate">
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <span className="truncate">{f.file}</span>
                        {noRows && (
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        )}
                        {hasLowMrp && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-100 border border-amber-300 rounded px-1.5 py-0.5 shrink-0">
                            <AlertTriangle className="w-3 h-3" />
                            {f.lowMrpCount} low MRP
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 ml-3 text-muted-foreground font-mono">
                        {f.newHistoryRows > 0
                          ? `+${f.newHistoryRows} prices`
                          : noRows
                          ? "0 rows"
                          : `${f.skippedDuplicates} dup`}
                      </span>
                    </button>
                    {isExpanded && (
                      <div className="px-3 pb-3 pt-1 border-t space-y-2">
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div className="bg-muted/30 rounded px-2 py-1">
                            <span className="text-muted-foreground">Code: </span>
                            {f.codeColHeader ? (
                              <code className="font-medium">{f.codeColHeader}</code>
                            ) : (
                              <span className="text-destructive">—</span>
                            )}
                          </div>
                          <div className="bg-muted/30 rounded px-2 py-1">
                            <span className="text-muted-foreground">Price: </span>
                            {f.priceColHeader ? (
                              <code className="font-medium">{f.priceColHeader}</code>
                            ) : (
                              <span className="text-destructive">—</span>
                            )}
                          </div>
                          <div className="bg-muted/30 rounded px-2 py-1">
                            <span className="text-muted-foreground">Basis: </span>
                            <span className="font-medium">{f.basis || "—"}</span>
                          </div>
                        </div>
                        <div className="grid grid-cols-4 gap-2 text-xs font-mono">
                          <div className="bg-muted/30 rounded px-2 py-1 text-center">
                            <div className="text-muted-foreground">Rows</div>
                            <div className="font-bold">{f.totalRows}</div>
                          </div>
                          <div className="bg-muted/30 rounded px-2 py-1 text-center">
                            <div className="text-muted-foreground">Matched</div>
                            <div className="font-bold text-green-600">{f.matchedProducts}</div>
                          </div>
                          <div className="bg-muted/30 rounded px-2 py-1 text-center">
                            <div className="text-muted-foreground">New</div>
                            <div className="font-bold">{f.newProducts}</div>
                          </div>
                          <div className="bg-muted/30 rounded px-2 py-1 text-center">
                            <div className="text-muted-foreground">Prices</div>
                            <div className="font-bold text-primary">{f.newHistoryRows}</div>
                          </div>
                        </div>
                        {f.skippedDuplicates > 0 && (
                          <p className="text-amber-600 text-xs">
                            {f.skippedDuplicates} duplicate{f.skippedDuplicates !== 1 ? "s" : ""} skipped
                          </p>
                        )}
                        {f.skippedUnparseable > 0 && (
                          <p className="text-amber-600 text-xs">
                            {f.skippedUnparseable} row{f.skippedUnparseable !== 1 ? "s" : ""} skipped — bad code or invalid price
                          </p>
                        )}
                        {f.message && (
                          <p className="text-muted-foreground text-xs">{f.message}</p>
                        )}
                        {f.lowMrpCount > 0 && !dismissedLowMrp.has(f.file) && (
                          <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-300 p-2 rounded">
                            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-500" />
                            <div className="flex-1">
                              <span className="font-semibold">
                                {f.lowMrpCount} item{f.lowMrpCount !== 1 ? "s" : ""} have MRP below ₹50 — verify the correct column was picked.
                              </span>
                              {f.priceColHeader && (
                                <span> Expected column: <code className="bg-amber-100 px-0.5 rounded">{f.priceColHeader}</code>.</span>
                              )}
                            </div>
                            <button
                              onClick={() => setDismissedLowMrp((prev) => new Set([...prev, f.file]))}
                              className="shrink-0 text-amber-600 hover:text-amber-800 text-base leading-none font-bold"
                              aria-label="Dismiss warning"
                            >
                              ×
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Zero-import warning — single file only */}
          {nothingImported && !result.files && (
            <div className="flex items-start gap-3 text-sm text-amber-800 bg-amber-50 border border-amber-300 p-3 rounded">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
              <div>
                <p className="font-semibold">No valid code-and-price rows could be read from this file.</p>
                {!result.codeColHeader && (
                  <p className="mt-1">No item-code column was found. Make sure the sheet has a header row with a column labelled "Code", "Item Code", or similar.</p>
                )}
                {result.codeColHeader && !result.priceColHeader && (
                  <p className="mt-1">A code column was found but no price column was detected. Make sure a column header contains "MRP", "Price", "Rate", or "Net".</p>
                )}
                {result.codeColHeader && result.priceColHeader && (
                  <p className="mt-1">Both columns were detected but no rows had a valid code and a positive price together.</p>
                )}
                {result.skippedUnparseable > 0 && (
                  <p className="mt-1">{result.skippedUnparseable} row{result.skippedUnparseable !== 1 ? "s" : ""} had a blank or unreadable code, or an invalid price.</p>
                )}
              </div>
            </div>
          )}

          {/* Skipped duplicates — single file only */}
          {!result.files && result.skippedDuplicates > 0 && (
            <div className="text-sm text-amber-600 bg-amber-50 p-3 rounded border border-amber-200">
              Skipped {result.skippedDuplicates} rows that matched existing prices for this date.
            </div>
          )}

          {/* Rows skipped due to bad codes / prices — single file only */}
          {!result.files && !nothingImported && result.skippedUnparseable > 0 && (
            <div className="text-sm text-amber-600 bg-amber-50 p-3 rounded border border-amber-200">
              {result.skippedUnparseable} row{result.skippedUnparseable !== 1 ? "s were" : " was"} skipped — item code could not be parsed or price was invalid.
            </div>
          )}

          {/* Low-MRP warning — single file only */}
          {!result.files && result.lowMrpCount > 0 && !dismissedLowMrp.has("__single__") && (
            <div className="flex items-start gap-3 text-sm text-amber-800 bg-amber-50 border border-amber-300 p-3 rounded">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
              <div className="flex-1">
                <p className="font-semibold">
                  ⚠ {result.lowMrpCount} item{result.lowMrpCount !== 1 ? "s" : ""} have MRP below ₹50 — verify the correct column was picked.
                </p>
                {result.priceColHeader && (
                  <p className="mt-1">
                    Expected column: <code className="bg-amber-100 px-1 rounded">{result.priceColHeader}</code>. If this is a packing-quantity column (e.g. pcs/box), re-upload with the correct MRP column.
                  </p>
                )}
              </div>
              <button
                onClick={() => setDismissedLowMrp((prev) => new Set([...prev, "__single__"]))}
                className="shrink-0 text-amber-600 hover:text-amber-800 text-lg leading-none font-bold"
                aria-label="Dismiss warning"
              >
                ×
              </button>
            </div>
          )}

          {/* Download unmatched */}
          {result.unmatchedCodes?.length > 0 && (
            <div className="flex items-center justify-between text-sm bg-muted/40 border rounded px-3 py-2">
              <span className="text-muted-foreground">
                {result.unmatchedCodes.length} code{result.unmatchedCodes.length !== 1 ? "s" : ""} not found in the existing catalog (added as new products)
              </span>
              <button
                onClick={handleDownloadUnmatched}
                className="flex items-center gap-1.5 text-primary hover:underline font-medium ml-4 shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                Download unmatched rows
              </button>
            </div>
          )}

          {/* General message — single file only */}
          {!result.files && result.message && (
            <div className="text-sm text-muted-foreground bg-muted p-3 rounded">
              {result.message}
            </div>
          )}
        </div>
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete MRP period {pendingDelete?.effectiveDate}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove all{" "}
              <strong>{pendingDelete?.count.toLocaleString()} price rows</strong> for effective date{" "}
              <strong>{pendingDelete?.effectiveDate}</strong>. Current prices for each product are
              determined by the latest period on or before today — deleting this period may change
              which prices are active. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting…" : "Delete period"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!duplicateSnapshot}
        onOpenChange={(open) => {
          if (!open) setDuplicateSnapshot(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Load the same snapshot again?</AlertDialogTitle>
            <AlertDialogDescription>
              This is byte-for-byte the file loaded on{" "}
              <strong>{duplicateSnapshot?.loadedAt?.slice(0, 10)}</strong> for{" "}
              <strong>{duplicateSnapshot?.sourceDivision}</strong>. It has SHA-256{" "}
              <code>{duplicateSnapshot?.fileSha256}</code>. Loading it again will be
              recorded, but duplicate price rows will not be added.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setDuplicateSnapshot(null);
                void submitUpload(true);
              }}
            >
              Load anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
