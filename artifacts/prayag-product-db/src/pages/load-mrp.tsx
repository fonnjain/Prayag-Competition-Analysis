import { CategorySpellingPreview } from "@/components/category-spelling-preview";
import type { CategorySpellingDecision } from "@workspace/api-client-react";
import { useEffect, useMemo, useState } from "react";
import { MasterClassificationPreview } from "@/components/MasterClassificationPreview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle, Calendar, Check, ChevronDown, ChevronRight, FileSpreadsheet, Loader2, Pencil, Trash2, Upload, X } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatMoney, formatCount } from "@workspace/formatting";
import { formatDisplayDate } from "@/lib/date-format";
import {
  getGetCatalogProductsQueryKey, getGetCatalogDataHealthQueryKey, getGetCatalogFiltersQueryKey,
  getGetComparisonQueryKey, getGetComparisonSummaryQueryKey, getGetComparisonByProductQueryKey,
} from "@workspace/api-client-react";

interface MrpPeriod { effectiveDate: string; count: number }
interface MrpSource { id: number; division: string; sheetUrl: string; expectedFileName: string | null }
interface PriceChange { itemCode: string; productName?: string | null; oldMrp: number | null; newMrp: number; effectiveDate: string; delta: number }
interface Preview {
  categorySpellings?: CategorySpellingDecision[];
  kind: string; rowsToWrite: number; productRows: number; priceRows: number;
  periods: { effectiveDate: string; rowCount: number; isNew: boolean; movedInCount: number }[];
  immediatePriceChanges: PriceChange[]; immediatePriceChangeCount: number;
  existingPeriodPriceRevisions?: PriceChange[];
  existingPeriodPriceRevisionCount?: number;
  newProducts: (string | { itemCode: string; productName?: string | null })[];
  catalogueProductsAbsentFromFile: string[];
  discontinuations: { total: number; immediate: number; future: number };
  protectedNameConflicts: unknown[];
  rejectedRows: { itemCode?: string; row?: number; reason: string }[];
  rejectedReasonSummary: Record<string, number>;
  classificationCounts?: { existingProducts: number; newNonRangeProducts: number; refusedNewRangeProducts: number };
  classificationDifferences?: { itemCode: string; message: string; differingFields: string[];
    stored: { division: string | null; category: string | null; seriesRange: string | null };
    file: { division: string; category: string | null; seriesRange: string | null; categoryProvided: boolean; rangeProvided: boolean } }[];
  classificationPolicy?: string;
  lifecyclePolicy?: string;
  canApply: boolean; noChangeReason: string | null;
}
interface PendingBatch {
  id?: number; batchId?: number; status: "pending" | "applied" | "discarded" | "expired" | "duplicate";
  expiresAt?: string; appliedAt?: string | null; appliedBy?: string | null;
  discardedAt?: string | null; discardedBy?: string | null; preview: Preview;
  result?: {
    kind?: string;
    summaries?: {
      reviewBatchId?: string | null;
      flaggedMrpCount?: number;
    }[];
  } | null;
}

function useMrpPeriods() {
  return useQuery<MrpPeriod[]>({ queryKey: ["catalog", "mrp-periods"], queryFn: async () => {
    const res = await fetch("/api/catalog/mrp-periods");
    if (!res.ok) throw new Error("Failed to load MRP periods");
    return (await res.json()).periods as MrpPeriod[];
  }});
}
function useMrpSources() {
  return useQuery<MrpSource[]>({ queryKey: ["catalog", "mrp-sources"], queryFn: async () => {
    const res = await fetch("/api/catalog/mrp-sources");
    if (!res.ok) throw new Error("Failed to load official MRP sources");
    return (await res.json()).sources as MrpSource[];
  }});
}
const formatMrp = (value: number | null) => value == null ? "No prior MRP" : formatMoney(Number(value));
const productCode = (product: string | { itemCode: string }) => typeof product === "string" ? product : product.itemCode;

export default function LoadMrpPage() {
  const [file, setFile] = useState<File | null>(null);
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().split("T")[0]);
  const [sourceId, setSourceId] = useState("");
  const [downloadedAt, setDownloadedAt] = useState(new Date().toISOString().split("T")[0]);
  const [batch, setBatch] = useState<PendingBatch | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewFeedback, setReviewFeedback] = useState<string | null>(null);
  const [showApplyConfirmation, setShowApplyConfirmation] = useState(false);
  const [showDiscardConfirmation, setShowDiscardConfirmation] = useState(false);
  const [showPriceChanges, setShowPriceChanges] = useState(false);
  const [duplicateMessage, setDuplicateMessage] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MrpPeriod | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editingPeriodDate, setEditingPeriodDate] = useState<string | null>(null);
  const [editedEffectiveDate, setEditedEffectiveDate] = useState("");
  const [isUpdatingPeriodDate, setIsUpdatingPeriodDate] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: periods, isLoading: periodsLoading } = useMrpPeriods();
  const { data: sources, isLoading: sourcesLoading } = useMrpSources();
  const selectedSource = sources?.find((source) => String(source.id) === sourceId);
  const preview = batch?.preview;
  const reviewBatchId = batch?.result?.summaries?.find(
    (summary) => (summary.flaggedMrpCount ?? 0) > 0 && summary.reviewBatchId,
  )?.reviewBatchId;
  const flaggedMrpCount =
    batch?.result?.summaries?.reduce(
      (count, summary) => count + (summary.flaggedMrpCount ?? 0),
      0,
    ) ?? 0;
  const batchId = batch?.id ?? batch?.batchId;
  const expired = !!batch?.expiresAt && new Date(batch.expiresAt).getTime() <= Date.now();
  const applyReason = useMemo(() => {
    if (!batch || !preview) return "Upload a file to create a preview.";
    if (batch.status === "applied") return "This preview has already been applied.";
    if (batch.status === "discarded") return "This preview was discarded.";
    if (batch.status === "expired" || expired) return "This preview expired after 24 hours and cannot be applied.";
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
    const res = await fetch(`/api/catalog/mrp-loads/${id}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not refresh MRP preview.");
    setBatch(data as PendingBatch);
  };
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("batchId");
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) return;
    void refreshBatch(id).catch((error) => {
      toast({
        title: "Could not reopen MRP preview",
        description:
          error instanceof Error ? error.message : "The saved preview is unavailable.",
        variant: "destructive",
      });
    });
  }, []);
  const submitUpload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file || !sourceId || !downloadedAt || !effectiveDate) return;
    setIsUploading(true);
    setDuplicateMessage(null);
    try {
      const form = new FormData();
      form.append("file", file); form.append("sourceId", sourceId); form.append("downloadedAt", downloadedAt); form.append("effectiveDate", effectiveDate);
      const res = await fetch("/api/catalog/load-mrp", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.duplicate) {
        if (data.preview) {
          setBatch({ status: "duplicate", preview: data.preview });
          const url = new URL(window.location.href);
          url.searchParams.delete("batchId");
          window.history.replaceState({}, "", url);
        }
        setDuplicateMessage(data.error || "This identical file has already been staged or loaded. No second preview was created.");
        return;
      }
      if (!res.ok) throw new Error(data.error || "Failed to upload file");
      setBatch({ id: data.batchId, status: data.status, expiresAt: data.expiresAt, preview: data.preview });
      const url = new URL(window.location.href);
      url.searchParams.set("batchId", String(data.batchId));
      window.history.replaceState({}, "", url);
      toast({ title: "Preview ready", description: "Nothing has been imported. Review the staged changes before applying them." });
    } catch (error) {
      toast({ title: "Upload failed", description: error instanceof Error ? error.message : "Failed to stage file.", variant: "destructive" });
    } finally { setIsUploading(false); }
  };
  const applyPreview = async () => {
    if (!batchId || !preview) return;
    setIsApplying(true);
    try {
      const res = await fetch(`/api/catalog/mrp-loads/${batchId}/apply`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowsToWrite: preview.rowsToWrite, immediatePriceChanges: preview.immediatePriceChangeCount }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not apply MRP preview.");
      await refreshBatch(batchId);
      invalidateAfterApply();
      toast({ title: "MRP preview applied", description: `${formatCount(preview.rowsToWrite)} rows were written.` });
    } catch (error) {
      toast({ title: "Apply failed", description: error instanceof Error ? error.message : "Could not apply MRP preview.", variant: "destructive" });
      try { await refreshBatch(batchId); } catch { /* retain the existing preview if status refresh fails */ }
    } finally { setIsApplying(false); setShowApplyConfirmation(false); }
  };
  const discardPreview = async () => {
    if (!batchId) return;
    setIsDiscarding(true);
    try {
      const res = await fetch(`/api/catalog/mrp-loads/${batchId}/discard`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not discard MRP preview.");
      setBatch(data as PendingBatch);
      toast({ title: "MRP preview discarded", description: "No catalogue or price rows were written." });
    } catch (error) {
      toast({ title: "Discard failed", description: error instanceof Error ? error.message : "Could not discard MRP preview.", variant: "destructive" });
    } finally { setIsDiscarding(false); setShowDiscardConfirmation(false); }
  };
  const reviewFlaggedPrices = async (decision: "approve" | "cancel") => {
    if (!reviewBatchId) return;
    setIsReviewing(true);
    try {
      const res = await fetch(
        `/api/catalog/mrp-review-batches/${reviewBatchId}/${decision}`,
        { method: "POST" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not complete price review.");
      const count = Number(
        decision === "approve" ? data.approved ?? 0 : data.cancelled ?? 0,
      );
      setReviewFeedback(
        decision === "approve"
          ? `${count} suspicious price row${count === 1 ? "" : "s"} approved.`
          : `${count} suspicious price row${count === 1 ? "" : "s"} removed.`,
      );
      setBatch((current) =>
        current?.result?.summaries
          ? {
              ...current,
              result: {
                ...current.result,
                summaries: current.result.summaries.map((summary) => ({
                  ...summary,
                  flaggedMrpCount: 0,
                })),
              },
            }
          : current,
      );
      invalidateAfterApply();
      toast({
        title:
          decision === "approve"
            ? "Flagged prices approved"
            : "Flagged prices cancelled",
        description:
          decision === "approve"
            ? `${count} reviewed row${count === 1 ? "" : "s"} can become current on its effective date.`
            : `${count} reviewed row${count === 1 ? "" : "s"} removed.`,
      });
    } catch (error) {
      toast({
        title: "Price review failed",
        description:
          error instanceof Error ? error.message : "Could not complete price review.",
        variant: "destructive",
      });
    } finally {
      setIsReviewing(false);
    }
  };
  const savePeriodDate = async () => {
    if (!editingPeriodDate || !editedEffectiveDate) return;
    setIsUpdatingPeriodDate(true);
    try {
      const res = await fetch("/api/catalog/mrp-period-date", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentEffectiveDate: editingPeriodDate, newEffectiveDate: editedEffectiveDate }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not change the effective date.");
      setEditingPeriodDate(null); invalidateAfterApply();
      toast({ title: "MRP effective date updated", description: `${data.moved} rows moved to ${formatDisplayDate(data.effectiveDate)}.` });
    } catch (error) { toast({ title: "Date change failed", description: error instanceof Error ? error.message : "Could not change effective date.", variant: "destructive" }); }
    finally { setIsUpdatingPeriodDate(false); }
  };
  const deletePeriod = async () => {
    if (!pendingDelete) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/catalog/mrp-period/${pendingDelete.effectiveDate}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to delete period");
      invalidateAfterApply(); toast({ title: "Period deleted", description: `Removed prices for ${formatDisplayDate(pendingDelete.effectiveDate)}.` });
    } catch (error) { toast({ title: "Delete failed", description: error instanceof Error ? error.message : "Could not delete period.", variant: "destructive" }); }
    finally { setIsDeleting(false); setPendingDelete(null); }
  };

  return <div className="p-8 max-w-5xl mx-auto space-y-8">
    <div><h1 className="text-3xl font-bold tracking-tight">Load MRP Sheet</h1><p className="text-muted-foreground mt-2">Stage a price sheet, review its effect, then explicitly apply it. Uploading never changes catalogue prices.</p></div>
    <div className="bg-card border rounded-lg p-6 space-y-4">
      <h2 className="font-semibold text-base flex items-center gap-2"><Calendar className="w-4 h-4 text-muted-foreground" />Existing MRP Periods</h2>
      {periodsLoading ? <p className="text-sm text-muted-foreground">Loading periods…</p> : !periods?.length ? <p className="text-sm text-muted-foreground">No MRP periods loaded yet.</p> : <div className="divide-y rounded-md border overflow-hidden">{periods.map(period => <div key={period.effectiveDate} className="flex items-center justify-between px-3 py-2.5 bg-muted/20">
        <div className="flex items-center gap-3">{editingPeriodDate === period.effectiveDate ? <Input type="date" value={editedEffectiveDate} onChange={e => setEditedEffectiveDate(e.target.value)} className="h-8 w-40" disabled={isUpdatingPeriodDate} /> : <span className="font-mono text-sm font-medium">{formatDisplayDate(period.effectiveDate)}</span>}<span className="text-xs text-muted-foreground">{formatCount(period.count)} items</span></div>
        <div className="flex gap-1">{editingPeriodDate === period.effectiveDate ? <><Button type="button" variant="ghost" size="sm" onClick={() => void savePeriodDate()} disabled={isUpdatingPeriodDate || !editedEffectiveDate}>{isUpdatingPeriodDate ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}</Button><Button type="button" variant="ghost" size="sm" onClick={() => setEditingPeriodDate(null)}><X className="w-3.5 h-3.5" /></Button></> : <Button type="button" variant="ghost" size="sm" onClick={() => { setEditingPeriodDate(period.effectiveDate); setEditedEffectiveDate(period.effectiveDate); }}><Pencil className="w-3.5 h-3.5 mr-1" />Change date</Button>}<Button variant="ghost" size="sm" className="text-destructive" disabled={periods.length <= 1} onClick={() => setPendingDelete(period)}><Trash2 className="w-3.5 h-3.5" /></Button></div>
      </div>)}</div>}
    </div>
    <div className="bg-card border rounded-lg p-6"><form data-activity="mrp_import.upload" onSubmit={submitUpload} className="space-y-6">
      <div className="space-y-2"><Label htmlFor="file">Price Sheet (Excel / CSV / ZIP)</Label><Input id="file" type="file" accept=".xlsx,.xls,.csv,.zip" onChange={e => setFile(e.target.files?.[0] || null)} required /></div>
      <div className="space-y-2"><Label htmlFor="source">Official source</Label><Select value={sourceId} onValueChange={setSourceId} disabled={sourcesLoading}><SelectTrigger id="source"><SelectValue placeholder={sourcesLoading ? "Loading sources…" : "Choose the source sheet"} /></SelectTrigger><SelectContent>{(sources ?? []).map(source => <SelectItem key={source.id} value={String(source.id)}>{source.division}</SelectItem>)}</SelectContent></Select>{selectedSource && <a href={selectedSource.sheetUrl} target="_blank" rel="noreferrer" className="block text-xs text-primary hover:underline">Open source sheet{selectedSource.expectedFileName ? ` · Expected: ${selectedSource.expectedFileName}` : ""}</a>}</div>
      <div className="grid gap-6 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="downloadedAt">File Downloaded On</Label><Input id="downloadedAt" type="date" value={downloadedAt} onChange={e => setDownloadedAt(e.target.value)} required /></div><div className="space-y-2"><Label htmlFor="effectiveDate">New Period Effective Date (w.e.f.)</Label><Input id="effectiveDate" type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} required /></div></div>
      <Button type="submit" disabled={!file || !sourceId || !downloadedAt || !effectiveDate || isUploading} className="w-full">{isUploading ? "Creating preview…" : <><Upload className="w-4 h-4 mr-2" />Preview upload</>}</Button>
    </form></div>
    {batch && preview && <section className="bg-card border rounded-lg p-6 space-y-6">
      <CategorySpellingPreview decisions={preview.categorySpellings} />
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-start"><div><h2 className="font-semibold text-lg flex gap-2 items-center"><FileSpreadsheet className="w-5 h-5 text-primary" />MRP load preview</h2><p className="text-sm text-muted-foreground mt-1">Batch #{batchId} · Status: <span className="font-medium capitalize">{expired && batch.status === "pending" ? "expired" : batch.status}</span>{batch.expiresAt && batch.status === "pending" && !expired ? ` · Expires ${new Date(batch.expiresAt).toLocaleString()}` : ""}</p></div>
        {batch.status === "applied" && <div className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">Applied{batch.appliedAt ? ` ${new Date(batch.appliedAt).toLocaleString()}` : ""}{batch.appliedBy ? ` by ${batch.appliedBy}` : ""}.</div>}
        {batch.status === "discarded" && <div className="rounded border border-muted bg-muted/50 px-3 py-2 text-sm">Discarded{batch.discardedAt ? ` ${new Date(batch.discardedAt).toLocaleString()}` : ""}{batch.discardedBy ? ` by ${batch.discardedBy}` : ""}.</div>}
      </div>
      <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-5 text-amber-950"><div className="flex gap-3"><AlertTriangle className="w-6 h-6 shrink-0 text-amber-600" /><div><h3 className="text-xl font-bold">{formatCount(preview.immediatePriceChangeCount)} existing product{preview.immediatePriceChangeCount === 1 ? "" : "s"} change price immediately</h3><p className="mt-1 text-sm">These periods are already effective: {[...new Set(preview.immediatePriceChanges.map(change => formatDisplayDate(change.effectiveDate)))].join(", ") || "none"}. {formatCount(preview.periods.reduce((sum, period) => sum + period.movedInCount, 0))} rows move into a period.</p></div></div>
        {!!preview.existingPeriodPriceRevisionCount && <p className="mt-3 text-sm"><strong>{formatCount(preview.existingPeriodPriceRevisionCount)}</strong> additional price revision{preview.existingPeriodPriceRevisionCount === 1 ? "" : "s"} update rows inside an already-existing period; they are listed separately from period-move changes.</p>}
        <Button type="button" variant="outline" className="mt-4 bg-white" onClick={() => setShowPriceChanges(value => !value)}>{showPriceChanges ? <ChevronDown className="w-4 h-4 mr-2" /> : <ChevronRight className="w-4 h-4 mr-2" />}{showPriceChanges ? "Hide" : "View"} price changes</Button>
        {showPriceChanges && <div className="mt-3 max-h-96 overflow-auto rounded border bg-white"><table className="w-full text-sm"><thead className="sticky top-0 bg-muted text-left"><tr><th className="p-2">Code</th><th className="p-2">Product</th><th className="p-2">Period</th><th className="p-2 text-right">Old</th><th className="p-2 text-right">New</th><th className="p-2 text-right">Change</th></tr></thead><tbody>{preview.immediatePriceChanges.map(change => <tr key={`${change.itemCode}-${change.effectiveDate}`} className="border-t"><td className="p-2 font-mono">{change.itemCode}</td><td className="p-2">{change.productName ?? "—"}</td><td className="p-2">{formatDisplayDate(change.effectiveDate)}</td><td className="p-2 text-right font-mono">{formatMrp(change.oldMrp)}</td><td className="p-2 text-right font-mono font-semibold">{formatMrp(change.newMrp)}</td><td className="p-2 text-right font-mono">{change.delta >= 0 ? "+" : ""}{formatMrp(change.delta)}</td></tr>)}</tbody></table></div>}</div>
      {!!preview.existingPeriodPriceRevisionCount && <PreviewList title={`Price revisions inside existing periods (${preview.existingPeriodPriceRevisionCount})`} empty="None.">{preview.existingPeriodPriceRevisions?.map(change => <div key={`${change.itemCode}-${change.effectiveDate}`} className="flex flex-wrap justify-between gap-2"><span><span className="font-mono">{change.itemCode}</span>{change.productName ? ` · ${change.productName}` : ""}</span><span className="font-mono">{formatMrp(change.oldMrp)} → {formatMrp(change.newMrp)}</span></div>)}</PreviewList>}
      {batch.status === "applied" && flaggedMrpCount > 0 && reviewBatchId && <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950"><h3 className="font-semibold">{formatCount(flaggedMrpCount)} suspicious price row{flaggedMrpCount === 1 ? "" : "s"} still require review</h3><p className="mt-1 text-sm">These rows were written in a blocked review state and cannot become current until approved.</p><div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" disabled={isReviewing} onClick={() => void reviewFlaggedPrices("cancel")}>Cancel flagged rows</Button><Button disabled={isReviewing} onClick={() => void reviewFlaggedPrices("approve")}>{isReviewing ? "Reviewing…" : "Approve flagged rows"}</Button></div></div>}
      {reviewFeedback && <div className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{reviewFeedback}</div>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Metric label="Rows to write" value={preview.rowsToWrite} /><Metric label="New products" value={preview.newProducts.length} /><Metric label="Absent from file" value={preview.catalogueProductsAbsentFromFile.length} /><Metric label="Protected names" value={preview.protectedNameConflicts.length} /></div>
      {preview.classificationCounts && <MasterClassificationPreview counts={preview.classificationCounts} differences={preview.classificationDifferences ?? []} policy={preview.classificationPolicy} lifecyclePolicy={preview.lifecyclePolicy} />}
      <PreviewList title="Periods in this file" empty="No periods found.">{preview.periods.map(period => <div key={period.effectiveDate} className="flex justify-between gap-3"><span className="font-mono">{formatDisplayDate(period.effectiveDate)} {period.isNew && <span className="ml-1 rounded bg-primary px-1.5 py-0.5 font-sans text-xs text-primary-foreground">new</span>}</span><span className="text-muted-foreground">{formatCount(period.rowCount)} rows · {formatCount(period.movedInCount)} moved in</span></div>)}</PreviewList>
      <div className="grid gap-4 md:grid-cols-2"><PreviewList title={`New products / codes (${preview.newProducts.length})`} empty="No new products.">{preview.newProducts.map(product => <span key={productCode(product)} className="font-mono mr-3 inline-block">{productCode(product)}</span>)}</PreviewList><PreviewList title={`Catalogue products absent from file (${preview.catalogueProductsAbsentFromFile.length})`} empty="None.">{preview.catalogueProductsAbsentFromFile.map(code => <span key={code} className="font-mono mr-3 inline-block">{code}</span>)}</PreviewList></div>
      <div className="grid gap-4 md:grid-cols-2"><div className="rounded border p-4"><h3 className="font-medium">Discontinuations</h3><p className="mt-2 text-sm"><strong>{formatCount(preview.discontinuations.total)}</strong> total · <strong className="text-amber-700">{formatCount(preview.discontinuations.immediate)}</strong> immediate · <strong>{formatCount(preview.discontinuations.future)}</strong> future</p></div><PreviewList title={`Protected-name conflicts (${preview.protectedNameConflicts.length})`} empty="None — audited names will not need preserving.">{preview.protectedNameConflicts.map((conflict, index) => <div key={index} className="font-mono text-xs break-all">{typeof conflict === "string" ? conflict : JSON.stringify(conflict)}</div>)}</PreviewList></div>
      <PreviewList title={`Rejected rows (${preview.rejectedRows.length})`} empty="No rejected rows.">{Object.entries(preview.rejectedReasonSummary).map(([reason, count]) => <div key={reason}><strong>{count}</strong> · {reason}</div>)}{preview.rejectedRows.map((row, index) => <div key={`${row.itemCode ?? index}-${index}`} className="text-xs text-muted-foreground">Row {row.row ?? "—"}{row.itemCode ? ` · ${row.itemCode}` : ""}: {row.reason}</div>)}</PreviewList>
      <div className="border-t pt-5"><p className={`mb-3 text-sm ${applyReason ? "text-muted-foreground" : "text-foreground"}`}>{applyReason ?? "Applying writes the exact staged preview in one transaction."}</p><div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="outline" disabled={batch.status !== "pending" || expired || isDiscarding || isApplying} onClick={() => setShowDiscardConfirmation(true)}>Discard preview</Button><Button disabled={!!applyReason || isApplying || isDiscarding} onClick={() => setShowApplyConfirmation(true)}>{isApplying ? "Applying…" : "Apply preview"}</Button></div></div>
    </section>}
    <AlertDialog open={!!pendingDelete} onOpenChange={open => { if (!open) setPendingDelete(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete MRP period {formatDisplayDate(pendingDelete?.effectiveDate)}?</AlertDialogTitle><AlertDialogDescription>This permanently removes all {formatCount(pendingDelete?.count)} price rows for this period.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel><AlertDialogAction onClick={deletePeriod} disabled={isDeleting} className="bg-destructive text-destructive-foreground">{isDeleting ? "Deleting…" : "Delete period"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={!!duplicateMessage} onOpenChange={open => { if (!open) setDuplicateMessage(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Identical file detected</AlertDialogTitle><AlertDialogDescription>{duplicateMessage} No bypass is available because identical files are rejected before staging. Upload a changed source file or review the existing pending batch.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Close</AlertDialogCancel></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={showApplyConfirmation} onOpenChange={setShowApplyConfirmation}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Apply this MRP preview?</AlertDialogTitle><AlertDialogDescription>This will write exactly <strong>{formatCount(preview?.rowsToWrite)} rows</strong>. <strong>{formatCount(preview?.immediatePriceChangeCount)} existing products change price immediately.</strong> This action updates the catalogue and cannot be undone here.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={isApplying}>Cancel</AlertDialogCancel><AlertDialogAction onClick={applyPreview} disabled={isApplying}>{isApplying ? "Applying…" : "Apply rows"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={showDiscardConfirmation} onOpenChange={setShowDiscardConfirmation}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Discard this MRP preview?</AlertDialogTitle><AlertDialogDescription>No rows will be written. The staged preview remains available as a record of this decision.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={isDiscarding}>Cancel</AlertDialogCancel><AlertDialogAction onClick={discardPreview} disabled={isDiscarding} className="bg-destructive text-destructive-foreground">{isDiscarding ? "Discarding…" : "Discard preview"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded bg-muted/50 p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 text-xl font-mono font-bold">{formatCount(value)}</div></div>; }
function PreviewList({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) { return <div className="rounded border p-4"><h3 className="font-medium">{title}</h3><div className="mt-2 max-h-52 overflow-auto space-y-1 text-sm">{children || <span className="text-muted-foreground">{empty}</span>}</div></div>; }