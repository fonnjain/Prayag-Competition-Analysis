import { formatMoney, formatCount } from "@workspace/formatting";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { AlertTriangle, ArchiveX, CheckCircle2, ChevronDown, ChevronRight, FilePlus, Loader2, Upload } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@workspace/replit-auth-web";
import {
  getGetCatalogProductsQueryKey,
  getGetCatalogDataHealthQueryKey,
  getGetCatalogFiltersQueryKey,
  getGetComparisonQueryKey,
  getGetComparisonSummaryQueryKey,
  getGetComparisonByProductQueryKey,
} from "@workspace/api-client-react";

interface ProductRow {
  itemCode: string;
  division: string;
  seriesRange: string;
  productName: string;
  size: string | null;
  mrp: number;
  effectiveDate: string;
}

interface RejectedRow {
  row: number;
  itemCode: string | null;
  reason: string;
}

interface PeriodEffect {
  effectiveDate: string;
  isExisting: boolean;
  existingCount: number;
  createCount: number;
  afterCount: number;
  isImmediate: boolean;
}

interface CompetitorEffect {
  movedCount: number;
  byCompetitor: Record<string, { competitorCode: string; prayagCode: string; batchId: number }[]>;
  remainingNeedsReview: { batchId: number; competitorCode: string; prayagCode: string | null; status: string }[];
}

interface Preview {
  kind: string;
  mode: string;
  fileName: string;
  fileSha256: string;
  reason: string;
  catalogBefore: number;
  catalogAfter: number;
  willCreateCount: number;
  willCreate: ProductRow[];
  rejectedCount: number;
  rejectedRows: RejectedRow[];
  periods: PeriodEffect[];
  immediateCount: number;
  immediateMessage: string | null;
  canApply: boolean;
  noChangeReason: string | null;
}

interface Batch {
  batchId: number;
  status: "pending" | "applied" | "discarded" | "expired";
  expiresAt: string | null;
  preview: Preview;
  result?: {
    loadBatchId: number;
    createdCount: number;
    catalogBefore: number;
    catalogAfter: number;
    periods: PeriodEffect[];
    competitorEffect: CompetitorEffect;
  } | null;
}

function formatDisplayDate(value: string | null | undefined): string {
  if (!value) return "—";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${match[3]} ${months[Number(match[2]) - 1]} ${match[1]}`;
}

const money = (value: number | null) =>
  value == null ? "—" : `${formatMoney(value)}`;

function getAuthHeaders(): Record<string, string> {
  try {
    const sid = localStorage.getItem("prayag_sid");
    if (sid) return { Authorization: `Bearer ${sid}` };
  } catch { /* ignore */ }
  return {};
}

export default function NewProductsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [file, setFile] = useState<File | null>(null);
  const [reason, setReason] = useState("");
  const [batch, setBatch] = useState<Batch | null>(null);

  const [isUploading, setIsUploading] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);

  const [showApplyConfirmation, setShowApplyConfirmation] = useState(false);
  const [showDiscardConfirmation, setShowDiscardConfirmation] = useState(false);
  const [showNewProducts, setShowNewProducts] = useState(false);

  const preview = batch?.preview;
  const batchId = batch?.batchId;
  const expired = !!batch?.expiresAt && new Date(batch.expiresAt).getTime() <= Date.now();

  const applyReason = useMemo(() => {
    if (!batch || !preview) return "Upload a file to create a preview.";
    if (batch.status === "applied") return "This batch has already been applied.";
    if (batch.status === "discarded") return "This batch was discarded.";
    if (batch.status === "expired" || expired) return "This preview expired and cannot be applied.";
    if (!preview.canApply) return preview.noChangeReason ?? "This preview has no changes to apply.";
    return null;
  }, [batch, preview, expired]);

  const invalidateAfterApply = () => {
    queryClient.invalidateQueries({ queryKey: ["catalog", "mrp-periods"] });
    queryClient.invalidateQueries({ queryKey: getGetCatalogProductsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetCatalogDataHealthQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetCatalogFiltersQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetComparisonQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetComparisonSummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetComparisonByProductQueryKey() });
  };

  const refreshBatch = async (id: number) => {
    const res = await fetch(`/api/catalog/new-products/${id}`, {
      headers: getAuthHeaders(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not refresh preview.");
    setBatch(data as Batch);
  };

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("batchId");
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) return;
    void refreshBatch(id).catch((error) => {
      toast({
        title: "Could not reopen preview",
        description: error instanceof Error ? error.message : "The saved preview is unavailable.",
        variant: "destructive",
      });
    });
  }, [toast]);

  const submitUpload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file || !reason.trim()) return;
    setIsUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("reason", reason.trim());
      const res = await fetch("/api/catalog/new-products/preview", {
        method: "POST",
        body: form,
        headers: getAuthHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to upload file");
      
      setBatch(data as Batch);
      const url = new URL(window.location.href);
      url.searchParams.set("batchId", String(data.batchId));
      window.history.replaceState({}, "", url);
      
      toast({
        title: "Preview ready",
        description: "Nothing has been imported yet. Review the staged changes.",
      });
    } catch (error) {
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Failed to stage file.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const applyPreview = async () => {
    if (!batchId || !preview) return;
    setIsApplying(true);
    try {
      const res = await fetch(`/api/catalog/new-products/${batchId}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ rowsToCreate: preview.willCreateCount }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not apply preview.");
      
      await refreshBatch(batchId);
      invalidateAfterApply();
      toast({
        title: "Products created",
        description: `${formatCount(preview.willCreateCount)} products have been added.`,
      });
    } catch (error) {
      toast({
        title: "Apply failed",
        description: error instanceof Error ? error.message : "Could not apply preview.",
        variant: "destructive",
      });
      try { await refreshBatch(batchId); } catch { /* retain existing */ }
    } finally {
      setIsApplying(false);
      setShowApplyConfirmation(false);
    }
  };

  const discardPreview = async () => {
    if (!batchId) return;
    setIsDiscarding(true);
    try {
      const res = await fetch(`/api/catalog/new-products/${batchId}/discard`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not discard preview.");
      
      setBatch(data as Batch);
      toast({
        title: "Preview discarded",
        description: "No products were created.",
      });
    } catch (error) {
      toast({
        title: "Discard failed",
        description: error instanceof Error ? error.message : "Could not discard preview.",
        variant: "destructive",
      });
    } finally {
      setIsDiscarding(false);
      setShowDiscardConfirmation(false);
    }
  };

  if (user?.role !== "admin") {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-3 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <h2 className="font-semibold">Administrator access required</h2>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Only administrators can upload and create new products.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto min-w-0 max-w-6xl space-y-7 p-5 sm:p-8">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#2d7c78]">Catalogue maintenance</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">New Products</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Upload a spreadsheet containing strictly new products. Existing item codes will be rejected. 
          To update prices for existing products, use the Price Revisions tool instead.
        </p>
      </div>

      <form onSubmit={submitUpload} data-testid="form-upload" className="grid min-w-0 gap-5 rounded-xl border bg-card p-5 shadow-sm lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-2 lg:col-span-2">
          <Label htmlFor="upload-file">Spreadsheet (Excel .xlsx or .xls)</Label>
          <Input 
            id="upload-file" 
            type="file" 
            accept=".xlsx,.xls" 
            onChange={e => setFile(e.target.files?.[0] || null)} 
            data-testid="input-file"
            required 
          />
          <p className="text-xs text-muted-foreground">Must contain columns: Item Code, Division, Series, Product, Size (optional), MRP, Date.</p>
        </div>
        
        <div className="space-y-2 lg:col-span-2">
          <Label htmlFor="upload-reason">Audit Reason</Label>
          <Textarea 
            id="upload-reason" 
            value={reason} 
            onChange={e => setReason(e.target.value)} 
            placeholder="e.g. New Sink SKUs introduced in August circular" 
            rows={2}
            data-testid="input-reason"
            required
          />
        </div>

        <div className="lg:col-span-2 flex items-center justify-between border-t pt-5">
          <p className="text-xs text-muted-foreground">Creating a preview does not change the live catalogue.</p>
          <Button 
            type="submit" 
            disabled={!file || !reason.trim() || isUploading}
            data-testid="button-preview"
          >
            {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            {isUploading ? "Reading workbook..." : "Preview New Products"}
          </Button>
        </div>
      </form>

      {batch && preview && (
        <section className="space-y-5" data-testid="section-preview">
          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <FilePlus className="h-5 w-5 text-[#2d7c78]" />
                  <h2 className="font-semibold text-lg">Batch {batch.batchId}</h2>
                </div>
                <p className="mt-1 font-medium">{preview.fileName}</p>
                <div className="flex items-center gap-2 mt-1">
                  <p className="text-xs font-mono text-muted-foreground truncate max-w-sm" title={preview.fileSha256}>
                    SHA-256 {preview.fileSha256}
                  </p>
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => {
                    navigator.clipboard.writeText(preview.fileSha256);
                    toast({ title: "Copied", description: "SHA-256 hash copied to clipboard." });
                  }}>
                    Copy
                  </Button>
                </div>
                <p className="mt-2 text-sm"><strong>Reason:</strong> {preview.reason}</p>
              </div>
              <div className="rounded border px-3 py-1.5 text-sm font-medium capitalize bg-muted/30">
                {expired && batch.status === "pending" ? "Expired" : batch.status}
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg bg-muted/45 p-3">
                <p className="text-xs text-muted-foreground">Catalogue Before</p>
                <p className="mt-1 text-xl font-bold" data-testid="text-catalog-before">{formatCount(preview.catalogBefore)}</p>
              </div>
              <div className="rounded-lg bg-[#2d7c78]/10 p-3 border border-[#2d7c78]/20">
                <p className="text-xs font-medium text-[#1d5d5a]">Will CREATE</p>
                <p className="mt-1 text-xl font-bold text-[#1d5d5a]" data-testid="text-will-create">{formatCount(preview.willCreateCount)}</p>
              </div>
              <div className="rounded-lg bg-destructive/10 p-3 border border-destructive/20">
                <p className="text-xs font-medium text-destructive">Rejected Rows</p>
                <p className="mt-1 text-xl font-bold text-destructive" data-testid="text-rejected">{formatCount(preview.rejectedCount)}</p>
              </div>
              <div className="rounded-lg bg-muted/45 p-3">
                <p className="text-xs text-muted-foreground">Catalogue After</p>
                <p className="mt-1 text-xl font-bold" data-testid="text-catalog-after">{formatCount(preview.catalogAfter)}</p>
              </div>
            </div>

            {preview.immediateCount > 0 && (
              <div className="mt-5 rounded-lg border-2 border-amber-400 bg-amber-50 p-4 text-amber-950">
                <div className="flex gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                  <div>
                    <h3 className="font-bold">{formatCount(preview.immediateCount)} products become live immediately</h3>
                    <p className="mt-1 text-sm">{preview.immediateMessage}</p>
                  </div>
                </div>
              </div>
            )}

            {preview.periods.length > 0 && (
              <div className="mt-5 rounded border p-4">
                <h3 className="text-sm font-semibold">Periods Affected</h3>
                <div className="mt-3 space-y-2">
                  {preview.periods.map(period => (
                    <div key={period.effectiveDate} className="flex flex-wrap items-center justify-between gap-4 text-sm bg-muted/20 px-3 py-2 rounded">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-medium">{formatDisplayDate(period.effectiveDate)}</span>
                        {!period.isExisting && (
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">New Period</span>
                        )}
                        {period.isImmediate && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">Past/Live</span>
                        )}
                      </div>
                      <div className="text-muted-foreground">
                        {formatCount(period.existingCount)} existing +
                        <strong className="mx-1 text-foreground">{formatCount(period.createCount)} new</strong>
                        = {formatCount(period.afterCount)} products
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {batch.result?.competitorEffect && (
              <div className="mt-5 rounded border p-4 bg-blue-50/50 border-blue-200" data-testid="apply-result-competitor">
                <h3 className="text-sm font-semibold text-blue-900">Competitor Mappings Rematched</h3>
                <p className="mt-1 text-sm text-blue-800">
                  {batch.result.competitorEffect.movedCount} rows moved from Needs Review to Ready (staging review status only).
                </p>
                {Object.entries(batch.result.competitorEffect.byCompetitor).map(([competitor, movedRows]) => (
                  <div key={competitor} className="mt-3">
                    <h4 className="text-xs font-semibold text-blue-900 mb-1">{competitor}</h4>
                    <div className="max-h-40 overflow-auto border border-blue-100 rounded bg-white/60">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-blue-100/50 text-blue-900 sticky top-0">
                          <tr>
                            <th className="px-3 py-1.5 font-medium">Competitor Code</th>
                            <th className="px-3 py-1.5 font-medium">Prayag Code</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-blue-50">
                          {movedRows.map((row, i) => (
                            <tr key={i} data-testid={`moved-row-${i}`}>
                              <td className="px-3 py-1.5 font-mono">{row.competitorCode}</td>
                              <td className="px-3 py-1.5 font-mono text-blue-700">{row.prayagCode}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}

                {batch.result.competitorEffect.remainingNeedsReview?.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-blue-100">
                    <h4 className="text-xs font-semibold text-amber-800 mb-2">Remaining Open Needs Review Rows</h4>
                    <ul className="space-y-1 text-xs text-amber-900">
                      {batch.result.competitorEffect.remainingNeedsReview.slice(0, 3).map((row, i) => (
                        <li key={i} data-testid={`remaining-row-${i}`}>
                          <span className="font-mono bg-white/50 px-1 rounded">{row.competitorCode}</span> 
                          {row.prayagCode ? ` (was matched to ${row.prayagCode})` : ""}
                        </li>
                      ))}
                      {batch.result.competitorEffect.remainingNeedsReview.length > 3 && (
                        <li className="text-amber-700 italic">...and {batch.result.competitorEffect.remainingNeedsReview.length - 3} more.</li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-start">
              <div className="flex-1 min-w-0 space-y-4">
                <div className="rounded border">
                  <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-3">
                    <h3 className="font-semibold text-sm">Will Create ({preview.willCreateCount})</h3>
                    {preview.willCreateCount > 0 && (
                      <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setShowNewProducts(!showNewProducts)}>
                        {showNewProducts ? <ChevronDown className="mr-1 h-3 w-3" /> : <ChevronRight className="mr-1 h-3 w-3" />}
                        {showNewProducts ? "Hide rows" : "View rows"}
                      </Button>
                    )}
                  </div>
                  {showNewProducts && preview.willCreateCount > 0 && (
                    <div className="max-h-80 overflow-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="sticky top-0 bg-muted/80 backdrop-blur text-xs text-muted-foreground">
                          <tr>
                            <th className="px-4 py-2 font-medium">Code / Product</th>
                            <th className="px-4 py-2 font-medium">Div / Series</th>
                            <th className="px-4 py-2 font-medium">Size</th>
                            <th className="px-4 py-2 font-medium text-right">MRP</th>
                            <th className="px-4 py-2 font-medium">W.E.F</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {preview.willCreate.map(row => (
                            <tr key={row.itemCode} className="hover:bg-muted/10">
                              <td className="px-4 py-2">
                                <div className="font-mono text-xs font-semibold">{row.itemCode}</div>
                                <div className="text-muted-foreground line-clamp-1" title={row.productName}>{row.productName}</div>
                              </td>
                              <td className="px-4 py-2 text-xs">
                                <div>{row.division}</div>
                                <div className="text-muted-foreground">{row.seriesRange}</div>
                              </td>
                              <td className="px-4 py-2 text-xs text-muted-foreground">{row.size || "—"}</td>
                              <td className="px-4 py-2 text-right font-mono font-medium">{money(row.mrp)}</td>
                              <td className="px-4 py-2 text-xs text-muted-foreground">{formatDisplayDate(row.effectiveDate)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              {preview.rejectedCount > 0 && (
                <div className="w-full lg:w-80 shrink-0 rounded border border-destructive/20 bg-destructive/5">
                  <div className="border-b border-destructive/10 px-4 py-3">
                    <h3 className="font-semibold text-sm text-destructive flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4" />
                      Rejected Rows ({preview.rejectedCount})
                    </h3>
                  </div>
                  <div className="max-h-80 overflow-auto p-4 space-y-3">
                    {preview.rejectedRows.map((row, i) => (
                      <div key={i} className="text-sm" data-testid="rejected-existing-code">
                        <div className="font-medium text-destructive">Row {row.row} {row.itemCode ? <span className="font-mono ml-1 text-xs">[{row.itemCode}]</span> : ""}</div>
                        <div className="text-destructive/80 text-xs mt-0.5">{row.reason}</div>
                      </div>
                    ))}
                    <div className="pt-2 text-xs text-destructive font-medium bg-destructive/10 p-2 rounded">
                      Use Price Revisions to update existing prices. New Products upload strictly requires novel item codes.
                    </div>
                  </div>
                </div>
              )}
            </div>

            {batch.status === "pending" && (
              <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t pt-5">
                {applyReason && (
                  <p className="max-w-md text-right text-sm text-muted-foreground mr-auto">{applyReason}</p>
                )}
                <Button
                  variant="outline"
                  disabled={isApplying || isDiscarding}
                  onClick={() => setShowDiscardConfirmation(true)}
                  data-testid="button-discard"
                >
                  <ArchiveX className="mr-2 h-4 w-4" />
                  Discard Preview
                </Button>
                <Button 
                  disabled={!!applyReason || isApplying || isDiscarding} 
                  onClick={() => setShowApplyConfirmation(true)}
                  data-testid="button-apply"
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  {isApplying ? "Applying..." : `Create ${preview.willCreateCount} products`}
                </Button>
              </div>
            )}
            
            {batch.status === "applied" && batch.result && (
              <div className="mt-6 flex items-center justify-between border-t pt-5 text-sm text-muted-foreground">
                <span>Applied successfully. Created {batch.result.createdCount} products.</span>
                <span className="font-mono text-xs">Load ID: {batch.result.loadBatchId}</span>
              </div>
            )}
          </div>
        </section>
      )}

      <AlertDialog open={showApplyConfirmation} onOpenChange={setShowApplyConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create {formatCount(preview?.willCreateCount)} new products?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently add <strong>{formatCount(preview?.willCreateCount)}</strong> novel item codes to the catalogue.
              {preview && preview.immediateCount > 0 && (
                <span className="block mt-2 font-medium text-amber-600">
                  {formatCount(preview.immediateCount)} products will go live immediately and appear in Price Finder.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isApplying}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={applyPreview} disabled={isApplying} data-testid="confirm-apply">
              {isApplying ? "Applying..." : "Create products"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDiscardConfirmation} onOpenChange={setShowDiscardConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this preview?</AlertDialogTitle>
            <AlertDialogDescription>
              No products will be created. You can upload a new spreadsheet to start over.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDiscarding}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={discardPreview} disabled={isDiscarding} className="bg-destructive text-destructive-foreground" data-testid="confirm-discard">
              {isDiscarding ? "Discarding..." : "Discard preview"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
