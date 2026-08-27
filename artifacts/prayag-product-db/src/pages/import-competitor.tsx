import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  FileUp,
  Upload,
  Trash2,
  Loader2,
  FileText,
  FileSpreadsheet,
  ChevronDown,
  ChevronRight,
  Calendar,
  Check,
  Pencil,
  X,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDisplayDate } from "@/lib/date-format";
import {
  useGetComparisonFilters,
  useDeleteCatalogCompetitor,
  useDeleteCompetitorPeriod,
  useGetCompetitorBrands,
  getGetComparisonQueryKey,
  getGetComparisonByProductQueryKey,
  getGetComparisonSummaryQueryKey,
  getGetComparisonFiltersQueryKey,
  getGetComparisonMatrixQueryKey,
  getGetMappingReviewQueryKey,
  getGetCompetitorBrandsQueryKey,
  previewCompetitorWorkbook,
  loadCompetitorWorkbook,
} from "@workspace/api-client-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

function formatDate(iso: string): string {
  return formatDisplayDate(iso);
}

interface SparshMasterPeriodDraft {
  key: string;
  label: string;
  sourceEffectiveDate: string;
  effectiveDate: string;
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

export default function ImportCompetitorPage() {
  const [, navigate] = useLocation();
  const [file, setFile] = useState<File | null>(null);
  const [competitor, setCompetitor] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [priceBasis, setPriceBasis] = useState<"MRP" | "Ex-GST">("MRP");
  const [gstPct, setGstPct] = useState<number>(18);
  const [sparshPeriods, setSparshPeriods] = useState<SparshMasterPeriodDraft[]>([]);
  const [isPreviewingWorkbook, setIsPreviewingWorkbook] = useState(false);
  const [workbookPreviewError, setWorkbookPreviewError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<any>(null);
  // SSE extraction progress state
  const [extractionProgress, setExtractionProgress] = useState<{
    stage: "preparing" | "extracting" | "matching" | null;
    chunk: number;
    totalChunks: number;
    startPage: number;
    endPage: number;
    totalItemsFound: number;
    statusMessage: string;
  } | null>(null);
  // Track which brands are expanded to show their periods
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editingPeriod, setEditingPeriod] = useState<{ competitor: string; effectiveDate: string } | null>(null);
  const [editedEffectiveDate, setEditedEffectiveDate] = useState("");
  const [isUpdatingPeriodDate, setIsUpdatingPeriodDate] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workbookPreviewSequence = useRef(0);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: filters } = useGetComparisonFilters();
  const { data: brandsData } = useGetCompetitorBrands();
  const competitors = filters?.competitors ?? [];
  const existingBrands = brandsData?.brands ?? [];
  const brandPeriods = brandsData?.brandPeriods ?? [];

  const isPdf = file?.name.toLowerCase().endsWith(".pdf") ?? false;
  const isAuthoritativeSparshMaster = sparshPeriods.length > 0;

  const invalidateComparisonQueries = () => {
    queryClient.invalidateQueries({ queryKey: getGetComparisonQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetComparisonByProductQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetComparisonSummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetComparisonFiltersQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetComparisonMatrixQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetMappingReviewQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetCompetitorBrandsQueryKey() });
  };

  const beginPeriodDateEdit = (brand: string, date: string) => {
    setEditingPeriod({ competitor: brand, effectiveDate: date });
    setEditedEffectiveDate(date);
  };

  const savePeriodDate = async () => {
    if (!editingPeriod || !editedEffectiveDate) return;
    setIsUpdatingPeriodDate(true);
    try {
      const response = await fetch("/api/catalog/competitor-period-date", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          competitor: editingPeriod.competitor,
          currentEffectiveDate: editingPeriod.effectiveDate,
          newEffectiveDate: editedEffectiveDate,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not change the effective date.");
      toast({
        title: "Effective Date Updated",
        description: `${data.moved} ${data.moved === 1 ? "row" : "rows"} moved to ${formatDate(data.effectiveDate)}.`,
      });
      setEditingPeriod(null);
      invalidateComparisonQueries();
    } catch (error) {
      toast({
        title: "Date Change Failed",
        description: error instanceof Error ? error.message : "Could not change the effective date.",
        variant: "destructive",
      });
    } finally {
      setIsUpdatingPeriodDate(false);
    }
  };

  const handleFileChange = async (nextFile: File | null) => {
    const requestSequence = ++workbookPreviewSequence.current;
    setFile(nextFile);
    setResult(null);
    setSparshPeriods([]);
    setWorkbookPreviewError(null);

    if (!nextFile || nextFile.name.toLowerCase().endsWith(".pdf")) {
      setIsPreviewingWorkbook(false);
      return;
    }

    setIsPreviewingWorkbook(true);
    try {
      const data = await previewCompetitorWorkbook({ file: nextFile });
      if (requestSequence !== workbookPreviewSequence.current) return;

      if (data.isSparshMaster && Array.isArray(data.periods) && data.periods.length > 0) {
        setSparshPeriods(
          data.periods.map((period: Omit<SparshMasterPeriodDraft, "effectiveDate">) => ({
            ...period,
            effectiveDate: period.sourceEffectiveDate,
          })),
        );
        setCompetitor("Sparsh Pearl");
        setPriceBasis("MRP");
      }
    } catch (error) {
      if (requestSequence !== workbookPreviewSequence.current) return;
      setWorkbookPreviewError(
        error instanceof Error ? error.message : "Could not read the uploaded workbook.",
      );
    } finally {
      if (requestSequence === workbookPreviewSequence.current) {
        setIsPreviewingWorkbook(false);
      }
    }
  };

  const recoverCompletedPdfBatch = async (batchId: number): Promise<boolean> => {
    setExtractionProgress((previous) => ({
      ...(previous ?? {
        stage: "extracting",
        chunk: 0,
        totalChunks: 0,
        startPage: 0,
        endPage: 0,
        totalItemsFound: 0,
      }),
      statusMessage:
        "Connection interrupted. Checking whether the server finished the extraction…",
    }));

    // The server keeps processing after a client stream drops. Poll the known
    // batch briefly so a completed import still lands on its review page rather
    // than making the reviewer upload the same PDF again.
    for (let attempt = 0; attempt < 24; attempt++) {
      try {
        const response = await fetch(`/api/catalog/import-batches/${batchId}`, {
          headers: getAuthHeaders(),
        });
        if (response.status === 401 || response.status === 403) return false;
        if (response.ok) {
          const batch = await response.json();
          if (batch.rowCounts) {
            toast({
              title: "Extraction Complete",
              description:
                "The connection was restored after extraction finished. Review the staged products before approving.",
            });
            navigate(`/import-review/${batchId}`);
            return true;
          }
        }
      } catch {
        // A transient retry failure should not discard a server-side batch.
      }
      await new Promise((resolve) => window.setTimeout(resolve, 5_000));
    }

    return false;
  };

  const deleteMutation = useDeleteCatalogCompetitor({
    mutation: {
      onSuccess: (data) => {
        toast({
          title: "Brand Removed",
          description: `Deleted ${data.deleted} price rows for ${data.competitor}.`,
        });
        invalidateComparisonQueries();
      },
      onError: (err: any) => {
        toast({
          title: "Delete Failed",
          description: err?.message || "Could not remove competitor brand.",
          variant: "destructive",
        });
      },
    },
  });

  const deletePeriodMutation = useDeleteCompetitorPeriod({
    mutation: {
      onSuccess: (data) => {
        toast({
          title: "Period Removed",
          description: `Deleted ${data.deleted} price rows for ${data.competitor} (${formatDate(data.effectiveDate)}).`,
        });
        invalidateComparisonQueries();
      },
      onError: (err: any) => {
        toast({
          title: "Delete Failed",
          description: err?.message || "Could not remove price period.",
          variant: "destructive",
        });
      },
    },
  });

  const toggleExpanded = (brand: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(brand)) next.delete(brand);
      else next.add(brand);
      return next;
    });
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    const hasCompleteSparshDates =
      sparshPeriods.length > 0 && sparshPeriods.every((period) => Boolean(period.effectiveDate));
    if (
      !file ||
      !competitor.trim() ||
      isPreviewingWorkbook ||
      workbookPreviewError ||
      (isAuthoritativeSparshMaster ? !hasCompleteSparshDates : !effectiveDate)
    ) {
      return;
    }

    setIsUploading(true);
    setResult(null);
    setExtractionProgress(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("competitor", competitor.trim());
    if (isAuthoritativeSparshMaster) {
      formData.append(
        "periodDates",
        JSON.stringify(sparshPeriods.map((period) => period.effectiveDate)),
      );
    } else {
      formData.append("effectiveDate", effectiveDate);
    }
    formData.append("priceBasis", priceBasis);
    if (priceBasis === "Ex-GST") formData.append("gstPct", String(gstPct));

    try {
      if (isPdf) {
        // PDF → SSE-streaming staging endpoint → navigate to review page
        const res = await fetch(`/api/catalog/import-batches`, {
          method: "POST",
          body: formData,
          headers: getAuthHeaders(),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error((data as any).error || "Failed to process PDF");
        }

        const contentType = res.headers.get("content-type") ?? "";
        if (!contentType.includes("text/event-stream") || !res.body) {
          // Fallback: treat as plain JSON (old behaviour)
          const data = await res.json();
          toast({
            title: "Extraction Complete",
            description: `Found ${(data.rowCounts?.ok ?? 0) + (data.rowCounts?.needs_review ?? 0)} matched products. Review before approving.`,
          });
          navigate(`/import-review/${data.batchId}`);
          return;
        }

        // Read the SSE stream
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let batchId: number | null = null;
        let serverReportedFailure = false;

        setExtractionProgress({
          stage: "preparing",
          chunk: 0,
          totalChunks: 0,
          startPage: 0,
          endPage: 0,
          totalItemsFound: 0,
          statusMessage: "Preparing extraction…",
        });

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // SSE events are separated by double newline
            const parts = buffer.split("\n\n");
            buffer = parts.pop() ?? "";

            for (const part of parts) {
              const eventLine = part.split("\n").find((l) => l.startsWith("event: "));
              const dataLine = part.split("\n").find((l) => l.startsWith("data: "));
              if (!dataLine) continue;

              const eventName = eventLine ? eventLine.slice(7).trim() : "message";
              let payload: any;
              try {
                payload = JSON.parse(dataLine.slice(6));
              } catch {
                continue;
              }

              if (eventName === "batch" && typeof payload.batchId === "number") {
                batchId = payload.batchId;
              } else if (eventName === "progress") {
                setExtractionProgress({
                  stage: "extracting",
                  chunk: payload.chunk,
                  totalChunks: payload.totalChunks,
                  startPage: payload.startPage,
                  endPage: payload.endPage,
                  totalItemsFound: payload.totalItemsFound,
                  statusMessage: `Processing pages ${payload.startPage}–${payload.endPage} of chunk ${payload.chunk}/${payload.totalChunks}…`,
                });
              } else if (eventName === "status") {
                setExtractionProgress((prev) => ({
                  ...(prev ?? {
                    chunk: 0, totalChunks: 0, startPage: 0, endPage: 0, totalItemsFound: 0,
                  }),
                  stage: payload.stage ?? prev?.stage ?? "preparing",
                  statusMessage: payload.message ?? prev?.statusMessage ?? "",
                }));
              } else if (eventName === "done") {
                const data = payload;
                // Persist failedChunks so the review page can show the warning
                if (Array.isArray(data.failedChunks) && data.failedChunks.length > 0) {
                  sessionStorage.setItem(
                    `importBatch_${data.batchId}_failedChunks`,
                    JSON.stringify(data.failedChunks),
                  );
                }
                toast({
                  title: "Extraction Complete",
                  description: `Found ${(data.rowCounts?.ok ?? 0) + (data.rowCounts?.needs_review ?? 0)} matched products. Review before approving.`,
                });
                navigate(`/import-review/${data.batchId}`);
                return;
              } else if (eventName === "error") {
                serverReportedFailure = true;
                throw new Error(payload.error || "Extraction failed");
              }
            }
          }
        } catch (streamError) {
          if (!serverReportedFailure && batchId && await recoverCompletedPdfBatch(batchId)) return;
          throw streamError;
        }

        // A proxy can end the response without surfacing a reader error. Recover
        // from the persisted batch in that case as well.
        if (batchId && await recoverCompletedPdfBatch(batchId)) return;
        throw new Error(
          "The extraction connection closed before the result arrived. The server may still be processing this batch; please try again in a moment.",
        );
      } else {
        // Excel/CSV → typed direct-import route
        const data = await loadCompetitorWorkbook({
          file,
          competitor: competitor.trim(),
          effectiveDate: isAuthoritativeSparshMaster ? undefined : effectiveDate,
          periodDates: isAuthoritativeSparshMaster
            ? JSON.stringify(sparshPeriods.map((period) => period.effectiveDate))
            : undefined,
          priceBasis,
          gstPct: priceBasis === "Ex-GST" ? gstPct : undefined,
        });

        setResult(data.results);
        const importedPeriods = data.results.periods;
        toast({
          title: "Upload Successful",
          description: importedPeriods
            ? `Imported ${data.results.inserted} verified rows for ${data.results.competitor} across ${importedPeriods.map((period) => formatDate(period.effectiveDate)).join(" and ")}.`
            : `Imported ${data.results.inserted} rows for ${data.results.competitor} (w.e.f. ${formatDate(effectiveDate)}).`,
        });
        invalidateComparisonQueries();

        setFile(null);
        setSparshPeriods([]);
        setWorkbookPreviewError(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    } catch (err: any) {
      toast({
        title: "Upload Failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      setExtractionProgress(null);
    }
  };

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Import Competitor Data</h1>
        <p className="text-muted-foreground mt-2">
          Upload an Excel/CSV price sheet for instant import, or a PDF catalogue for
          AI-powered extraction with a review step before committing.
        </p>
      </div>

      <div className="bg-card border rounded-lg p-6">
        <form onSubmit={handleUpload} className="space-y-6">
          {/* Brand + Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="competitor">Competitor Brand Name</Label>
              <Input
                id="competitor"
                list="brand-suggestions"
                type="text"
                placeholder="e.g. Sparsh Pearl, Astral"
                value={competitor}
                onChange={(e) => setCompetitor(e.target.value)}
                required
              />
              <datalist id="brand-suggestions">
                {existingBrands.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
              {existingBrands.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Existing: {existingBrands.join(", ")}
                </p>
              )}
            </div>

            {isAuthoritativeSparshMaster ? (
              <div className="space-y-3">
                <Label>Detected Sparsh Price Periods</Label>
                {sparshPeriods.map((period, index) => (
                  <div key={period.key} className="rounded-md border bg-muted/30 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium">{period.label}</span>
                      <span className="text-xs text-muted-foreground">
                        Workbook: {formatDate(period.sourceEffectiveDate)}
                      </span>
                    </div>
                    <Input
                      type="date"
                      value={period.effectiveDate}
                      onChange={(event) =>
                        setSparshPeriods((current) =>
                          current.map((currentPeriod, currentIndex) =>
                            currentIndex === index
                              ? { ...currentPeriod, effectiveDate: event.target.value }
                              : currentPeriod,
                          ),
                        )
                      }
                      aria-label={`${period.label} effective date`}
                      data-testid={`input-sparsh-period-date-${period.key}`}
                    />
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  Choose the effective date for each detected period. Importing replaces only
                  Sparsh Pearl prices and retains the workbook date in the audit record.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="effectiveDate">Price Effective Date</Label>
                <Input
                  id="effectiveDate"
                  type="date"
                  value={effectiveDate}
                  onChange={(e) => setEffectiveDate(e.target.value)}
                  required
                  data-testid="input-competitor-effective-date"
                />
                <p className="text-xs text-muted-foreground">
                  The date from which these prices apply (w.e.f.).
                </p>
              </div>
            )}
          </div>

          {/* Price Basis */}
          <div className="space-y-3">
            <Label>Price Basis</Label>
            <div className="flex gap-3">
              {(["MRP", "Ex-GST"] as const).map((basis) => (
                <button
                  key={basis}
                  type="button"
                  onClick={() => setPriceBasis(basis)}
                  className={`flex-1 py-2.5 px-4 rounded-md border text-sm font-medium transition-colors ${
                    priceBasis === basis
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-foreground border-border hover:bg-muted"
                  }`}
                >
                  {basis === "MRP" ? "MRP (final retail price)" : "Ex-GST (add GST to compare)"}
                </button>
              ))}
            </div>
            {priceBasis === "Ex-GST" && (
              <div className="flex items-center gap-3">
                <Label htmlFor="gstPct" className="whitespace-nowrap">GST %</Label>
                <Input
                  id="gstPct"
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={gstPct}
                  onChange={(e) => setGstPct(Number(e.target.value))}
                  className="w-24"
                />
                <p className="text-xs text-muted-foreground">
                  Prices will be multiplied by {(1 + gstPct / 100).toFixed(2)} before comparing to Prayag MRP.
                </p>
              </div>
            )}
          </div>

          {/* File input */}
          <div className="space-y-2">
            <Label htmlFor="file">Price File</Label>
            <Input
              ref={fileInputRef}
              id="file"
              type="file"
              accept=".xlsx,.xls,.csv,.pdf"
              onChange={(e) => void handleFileChange(e.target.files?.[0] || null)}
              required
            />
            {file && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {isPdf ? (
                  <FileText className="w-4 h-4 text-red-500" />
                ) : (
                  <FileSpreadsheet className="w-4 h-4 text-green-600" />
                )}
                <span className="font-medium">{file.name}</span>
                {isPdf ? (
                  <span className="text-amber-600">
                    — PDF detected. Claude will extract prices; you'll review before committing.
                    {file.size > 50 * 1024 * 1024
                      ? " Large file — extraction may take 60–90 seconds."
                      : " Extraction takes ~30 seconds."}
                  </span>
                ) : (
                  <span>
                    {isPreviewingWorkbook
                      ? "— checking workbook periods…"
                      : isAuthoritativeSparshMaster
                      ? "— verified Sparsh master detected; review or change each period date before importing."
                      : "— will import directly"}
                  </span>
                )}
              </div>
            )}
            {workbookPreviewError && (
              <p className="text-xs text-destructive" data-testid="text-workbook-preview-error">
                {workbookPreviewError}
              </p>
            )}
          </div>

          {/* PDF extraction progress bar */}
          {isUploading && isPdf && extractionProgress && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{extractionProgress.statusMessage}</span>
                {extractionProgress.totalChunks > 0 && (
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {extractionProgress.chunk}/{extractionProgress.totalChunks} chunks
                  </span>
                )}
              </div>
              <Progress
                value={
                  extractionProgress.totalChunks > 0
                    ? Math.round((extractionProgress.chunk / extractionProgress.totalChunks) * 100)
                    : extractionProgress.stage === "matching"
                    ? 95
                    : 5
                }
                className="h-2"
              />
              {extractionProgress.totalItemsFound > 0 && (
                <p className="text-xs text-muted-foreground text-right">
                  {extractionProgress.totalItemsFound} items found so far
                </p>
              )}
            </div>
          )}

          <Button
            type="submit"
            disabled={
              !file ||
              !competitor.trim() ||
              isPreviewingWorkbook ||
              Boolean(workbookPreviewError) ||
              (isAuthoritativeSparshMaster
                ? !sparshPeriods.every((period) => Boolean(period.effectiveDate))
                : !effectiveDate) ||
              isUploading
            }
            className="w-full"
            data-testid="button-import-competitor"
          >
            {isUploading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {isPdf ? "Extracting…" : "Uploading…"}
              </>
            ) : isPdf ? (
              <>
                <FileText className="w-4 h-4 mr-2" />
                Extract &amp; Stage for Review
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                Import Prices
              </>
            )}
          </Button>
        </form>
      </div>

      {/* Excel import result summary */}
      {result && (
        <div className="bg-card border rounded-lg p-6 space-y-4">
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <FileUp className="w-5 h-5 text-primary" />
            Import Summary: {result.competitor}
          </h3>
          {Array.isArray(result.periods) ? (
            <p className="text-sm text-muted-foreground" data-testid="text-import-master-periods">
              Effective dates:{" "}
              <span className="font-mono font-medium">
                {result.periods
                  .map((period: {
                    label?: string;
                    sourceEffectiveDate?: string;
                    effectiveDate: string;
                  }) => {
                    const appliedDate = formatDate(period.effectiveDate);
                    return period.sourceEffectiveDate &&
                      period.sourceEffectiveDate !== period.effectiveDate
                      ? `${period.label ?? "Period"}: ${formatDate(period.sourceEffectiveDate)} → ${appliedDate}`
                      : `${period.label ? `${period.label}: ` : ""}${appliedDate}`;
                  })
                  .join(" · ")}
              </span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Effective date:{" "}
              <span className="font-mono font-medium">{formatDate(effectiveDate)}</span>
            </p>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="p-4 bg-muted/50 rounded-md">
              <div className="text-sm text-muted-foreground mb-1">Total Rows</div>
              <div className="text-2xl font-mono font-bold">{result.totalRows}</div>
            </div>
            <div className="p-4 bg-muted/50 rounded-md">
              <div className="text-sm text-muted-foreground mb-1">Inserted</div>
              <div className="text-2xl font-mono font-bold text-primary">{result.inserted}</div>
            </div>
            <div className="p-4 bg-muted/50 rounded-md">
              <div className="text-sm text-muted-foreground mb-1">Auto-Matched</div>
              <div className="text-2xl font-mono font-bold text-green-600">{result.matched}</div>
            </div>
            <div className="p-4 bg-muted/50 rounded-md">
              <div className="text-sm text-muted-foreground mb-1">Unmatched</div>
              <div className="text-2xl font-mono font-bold text-amber-600">{result.unmatched}</div>
            </div>
          </div>

          {result.unmatched > 0 && (
            <div className="text-sm text-amber-600 bg-amber-50 p-3 rounded border border-amber-200">
              {result.unmatched} rows need mapping. Visit the Mapping Review page.
            </div>
          )}
        </div>
      )}

      {/* Tracked Brands */}
      <div className="bg-card border rounded-lg p-6 space-y-4">
        <div>
          <h3 className="font-semibold text-lg">Tracked Competitor Brands</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Expand a brand to correct an effective date, remove an individual period, or remove the entire brand at once.
          </p>
        </div>

        {competitors.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center border border-dashed rounded-md">
            No competitor brands loaded yet. Upload a price sheet above to get started.
          </div>
        ) : (
          <ul className="divide-y border rounded-md">
            {competitors.map((brand) => {
              const isExpanded = expanded.has(brand);
              const periods = brandPeriods.find((bp) => bp.brand === brand)?.effectiveDates ?? [];
              const isDeletingBrand =
                deleteMutation.isPending &&
                deleteMutation.variables?.competitor === brand;

              return (
                <li key={brand} className="flex flex-col">
                  {/* Brand header row */}
                  <div className="flex items-center justify-between gap-4 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(brand)}
                      className="flex items-center gap-2 flex-1 min-w-0 text-left"
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      )}
                      <span className="font-medium">{brand}</span>
                      <span className="text-xs text-muted-foreground ml-1">
                        {periods.length} {periods.length === 1 ? "period" : "periods"}
                      </span>
                    </button>

                    {/* Remove entire brand */}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10 flex-shrink-0"
                          disabled={deleteMutation.isPending || deletePeriodMutation.isPending}
                        >
                          {isDeletingBrand ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4 mr-2" />
                          )}
                          Remove All
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove {brand}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This permanently deletes{" "}
                            <strong>
                              all {periods.length} price{" "}
                              {periods.length === 1 ? "period" : "periods"}
                            </strong>{" "}
                            for {brand}. The brand will disappear from the comparison
                            filters, By Product columns, and summary KPIs. This cannot
                            be undone — you would need to re-upload its price sheets to
                            restore it.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() =>
                              deleteMutation.mutate({ competitor: brand })
                            }
                          >
                            Remove Brand
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>

                  {/* Expanded period list */}
                  {isExpanded && periods.length > 0 && (
                    <ul className="border-t bg-muted/30 divide-y">
                      {[...periods].reverse().map((date) => {
                        const isEditingPeriod =
                          editingPeriod?.competitor === brand &&
                          editingPeriod.effectiveDate === date;
                        const isDeletingPeriod =
                          deletePeriodMutation.isPending &&
                          deletePeriodMutation.variables?.competitor === brand &&
                          deletePeriodMutation.variables?.effectiveDate === date;

                        return (
                          <li
                            key={date}
                            className="flex items-center justify-between gap-4 px-6 py-2"
                          >
                            <div className="flex items-center gap-2 text-sm min-w-0">
                              <Calendar className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                              {isEditingPeriod ? (
                                <Input
                                  type="date"
                                  value={editedEffectiveDate}
                                  onChange={(event) => setEditedEffectiveDate(event.target.value)}
                                  aria-label={`${brand} effective date`}
                                  className="h-8 w-40"
                                  disabled={isUpdatingPeriodDate}
                                />
                              ) : (
                                <>
                                  <span className="font-medium">{formatDate(date)}</span>
                                  <span className="text-xs text-muted-foreground font-mono">
                                    ({date})
                                  </span>
                                </>
                              )}
                            </div>

                            <div className="flex items-center gap-1">
                              {isEditingPeriod ? (
                                <>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-primary"
                                    onClick={() => void savePeriodDate()}
                                    disabled={isUpdatingPeriodDate || !editedEffectiveDate}
                                  >
                                    {isUpdatingPeriodDate ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                    <span className="sr-only">Save effective date</span>
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2"
                                    onClick={() => setEditingPeriod(null)}
                                    disabled={isUpdatingPeriodDate}
                                  >
                                    <X className="w-3 h-3" />
                                    <span className="sr-only">Cancel date change</span>
                                  </Button>
                                </>
                              ) : (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-primary hover:text-primary"
                                  onClick={() => beginPeriodDateEdit(brand, date)}
                                  disabled={deleteMutation.isPending || deletePeriodMutation.isPending}
                                >
                                  <Pencil className="w-3 h-3 mr-1" />
                                  Change date
                                </Button>
                              )}
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive hover:text-destructive hover:bg-destructive/10 h-7 text-xs flex-shrink-0"
                                  disabled={
                                    deleteMutation.isPending ||
                                    deletePeriodMutation.isPending
                                  }
                                >
                                  {isDeletingPeriod ? (
                                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                  ) : (
                                    <Trash2 className="w-3 h-3 mr-1" />
                                  )}
                                  Remove period
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>
                                    Remove {brand} — {formatDate(date)}?
                                  </AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This permanently deletes all price rows for{" "}
                                    <strong>{brand}</strong> with effective date{" "}
                                    <strong>{date}</strong>. Other periods for this
                                    brand are kept.
                                    {periods.length === 1 && (
                                      <>
                                        {" "}Since this is the only period,{" "}
                                        <strong>
                                          {brand} will be removed entirely
                                        </strong>{" "}
                                        from the comparison.
                                      </>
                                    )}
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    onClick={() =>
                                      deletePeriodMutation.mutate({
                                        competitor: brand,
                                        effectiveDate: date,
                                      })
                                    }
                                  >
                                    Remove Period
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
