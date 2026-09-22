import { formatMoney } from "@workspace/formatting";
import { useMemo, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getCheckPriceEditorNewProductCodeQueryKey,
  useGetPriceEditorNewProductOptions,
  useCheckPriceEditorNewProductCode,
  usePreviewPriceEditorNewProduct,
  useApplyPriceEditorNewProduct,
  useGetPriceEditorNewProductUndoStatus,
  useUndoPriceEditorNewProduct,
  useDeactivatePriceEditorNewProduct,
  NewProductRequest
} from "@workspace/api-client-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { productDetailHref } from "@/lib/product-links";
import { AlertTriangle, CheckCircle2, Undo2, XCircle } from "lucide-react";
import { useEditorInvalidate } from "./price-editor";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function levenshtein(a: string, b: string) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  let i;
  for (i = 0; i <= b.length; i++) { matrix[i] = [i]; }
  let j;
  for (j = 0; j <= a.length; j++) { matrix[0][j] = j; }
  for (i = 1; i <= b.length; i++) {
    for (j = 1; j <= a.length; j++) {
      if (b.charAt(i-1) == a.charAt(j-1)) {
        matrix[i][j] = matrix[i-1][j-1];
      } else {
        matrix[i][j] = Math.min(matrix[i-1][j-1] + 1, Math.min(matrix[i][j-1] + 1, matrix[i-1][j] + 1));
      }
    }
  }
  return matrix[b.length][a.length];
}

const today = () => new Date().toISOString().slice(0, 10);
const money = (n: number | null | undefined) => n == null ? "—" : `${formatMoney(n)}`;
const date = (s?: string | null) => s ? new Date(`${s}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const errorText = (e: unknown) => e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "The request failed. Try again.";

export function ProductCreationTab() {
  const options = useGetPriceEditorNewProductOptions();
  
  const [code, setCode] = useState("");
  const [debouncedCode, setDebouncedCode] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedCode(code), 400);
    return () => clearTimeout(timer);
  }, [code]);

  const [productName, setProductName] = useState("");
  const [division, setDivision] = useState("");
  const [category, setCategory] = useState("");
  const [series, setSeries] = useState("");
  const [size, setSize] = useState("");
  const [value, setValue] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(today());
  const [remarks, setRemarks] = useState("");
  const [newSeriesConfirmed, setNewSeriesConfirmed] = useState(false);
  const [unusualCodeConfirmed, setUnusualCodeConfirmed] = useState(false);
  
  const [snapshot, setSnapshot] = useState<NewProductRequest | null>(null);
  const [saved, setSaved] = useState<{ id: number; message: string; itemCode: string; actor: string; createdAt: string; movedCompetitorRows: number[]; movedCompetitorDetails: any[] } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  
  const formVersion = useRef(0);
  
  const codeCheck = useCheckPriceEditorNewProductCode(
    { itemCode: debouncedCode, division: division || undefined }, 
    { query: { enabled: debouncedCode.trim().length > 1, queryKey: getCheckPriceEditorNewProductCodeQueryKey({ itemCode: debouncedCode, division: division || undefined }) } }
  );

  const preview = usePreviewPriceEditorNewProduct();
  const apply = useApplyPriceEditorNewProduct();
  
  const divisionOptions = useMemo(() => {
    return options.data?.byDivision.find(d => d.division === division) ?? null;
  }, [options.data, division]);

  const isCodeDuplicate = !!codeCheck.data?.duplicate;
  const isNewSeries = series.trim().length > 0 && !!divisionOptions && !divisionOptions.series.includes(series.trim());
  const nearestSeries = useMemo(() => {
    if (!isNewSeries || !divisionOptions) return [];
    return [...divisionOptions.series]
      .sort((a, b) => levenshtein(a.toLowerCase(), series.trim().toLowerCase()) - levenshtein(b.toLowerCase(), series.trim().toLowerCase()))
      .slice(0, 3);
  }, [series, isNewSeries, divisionOptions]);

  const numeric = Number(value);
  const isUnusualCode = codeCheck.data?.unusualShape ?? false;

  const canPreview = !isCodeDuplicate && debouncedCode.trim().length > 1 && debouncedCode === code &&
    productName.trim().length > 0 && 
    division && category && series.trim().length > 0 && numeric > 0 && effectiveDate && remarks.trim().length > 0 &&
    (!isNewSeries || newSeriesConfirmed);

  const invalidate = useEditorInvalidate();

  const change = () => {
    formVersion.current += 1;
    setSnapshot(null);
    setSaved(null);
    setFormError(null);
    preview.reset();
  };

  const handleDivisionChange = (val: string) => {
    setDivision(val);
    setCategory("");
    setSeries("");
    change();
  };

  const runPreview = () => {
    if (!canPreview) return;
    const request: NewProductRequest = {
      itemCode: debouncedCode.trim(),
      productName: productName.trim(),
      division,
      series: series.trim(),
      category,
      size: size.trim() || null,
      mrp: numeric,
      effectiveDate,
      reason: remarks.trim(),
      newSeriesConfirmed: isNewSeries ? newSeriesConfirmed : undefined
    };
    const requestVersion = formVersion.current;
    setFormError(null);
    preview.mutate({ data: request }, {
      onSuccess: () => {
        if (formVersion.current === requestVersion) {
          setSnapshot(request);
          setUnusualCodeConfirmed(false);
        }
      },
      onError: e => { setSnapshot(null); setFormError(errorText(e)); },
    });
  };

  const saveChange = () => {
    if (!snapshot || !preview.data) return;
    setFormError(null);
    apply.mutate({ data: { ...snapshot, token: preview.data.token, unusualCodeConfirmed: preview.data.unusualShape ? unusualCodeConfirmed : undefined } }, {
      onSuccess: result => {
        setSaved({ 
          id: result.audit.id, 
          itemCode: snapshot.itemCode,
          actor: result.audit.actor,
          createdAt: result.audit.createdAt,
          movedCompetitorRows: result.movedCompetitorRows,
          movedCompetitorDetails: result.movedCompetitorDetails || [],
          message: `Created product ${snapshot.itemCode} with initial price ${money(snapshot.mrp)}.` 
        });
        setSnapshot(null);
        setCode("");
        setProductName("");
        setSize("");
        setValue("");
        setRemarks("");
        setNewSeriesConfirmed(false);
        setUnusualCodeConfirmed(false);
        invalidate();
      },
      onError: e => setFormError(errorText(e)),
    });
  };

  return (
    <div className="space-y-6">
      {saved && <SavedResult result={saved} onClear={() => setSaved(null)} invalidate={invalidate} />}
      {formError && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Could not complete request</AlertTitle><AlertDescription>{formError}</AlertDescription></Alert>}
      
      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="font-semibold mb-4">1. Product Identity</h2>
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium">Division <span className="text-destructive">*</span>
              <select data-testid="select-division" disabled={apply.isPending} className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={division} onChange={e => handleDivisionChange(e.target.value)}>
                <option value="">Select division…</option>
                {options.data?.divisions.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
          </div>
          <div>
            <label className="block text-sm font-medium">Category <span className="text-destructive">*</span>
              <select data-testid="select-category" disabled={apply.isPending || !divisionOptions} className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={category} onChange={e => { setCategory(e.target.value); change(); }}>
                <option value="">Select category…</option>
                {divisionOptions?.categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>
          <div>
            <label className="block text-sm font-medium">Item Code <span className="text-destructive">*</span>
              <Input data-testid="input-code" disabled={apply.isPending} className="mt-1" value={code} onChange={e => { setCode(e.target.value); change(); }} placeholder="e.g. A2204" />
            </label>
            {codeCheck.data && code === debouncedCode && (
              <div className="mt-2 text-sm">
                {codeCheck.data.duplicate ? (
                  <Alert variant="destructive" className="py-2 px-3">
                    <XCircle className="h-4 w-4" />
                    <AlertTitle className="text-sm font-semibold mb-1">Code already exists</AlertTitle>
                    <AlertDescription className="text-xs">
                      {codeCheck.data.normalizedCode} is already a product in {codeCheck.data.duplicate.division} / {codeCheck.data.duplicate.category}. Series: {codeCheck.data.duplicate.series}. Current MRP: {money(codeCheck.data.duplicate.currentMrp)} (effective {codeCheck.data.duplicate.currentEffectiveDate ? date(codeCheck.data.duplicate.currentEffectiveDate) : "—"}).
                    </AlertDescription>
                  </Alert>
                ) : codeCheck.data.unusualShape ? (
                  <p className="text-amber-600 font-medium text-xs mt-1">Warning: {codeCheck.data.normalizedCode} has an unusual format. Closest existing codes: {codeCheck.data.closest.join(', ')}.</p>
                ) : (
                  <p className="text-emerald-600 font-medium text-xs mt-1">✓ {codeCheck.data.normalizedCode} is available.</p>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium">Product Name <span className="text-destructive">*</span>
              <Input data-testid="input-product-name" disabled={apply.isPending} className="mt-1" value={productName} onChange={e => { setProductName(e.target.value); change(); }} />
            </label>
          </div>
          <div>
            <label className="block text-sm font-medium">Size <span className="text-muted-foreground font-normal">(Optional)</span>
              <Input data-testid="input-size" disabled={apply.isPending} className="mt-1" value={size} onChange={e => { setSize(e.target.value); change(); }} />
            </label>
          </div>
        </div>
      </section>

      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="font-semibold mb-4">2. Initial Price configuration</h2>
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium">Series <span className="text-destructive">*</span>
              <Input data-testid="input-series" list="series-options" disabled={apply.isPending || !divisionOptions} className="mt-1" value={series} onChange={e => { setSeries(e.target.value); change(); }} />
              <datalist id="series-options">
                {divisionOptions?.series.map(s => <option key={s} value={s} />)}
              </datalist>
            </label>
            {isNewSeries && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm text-amber-800 font-medium">This is a new series.</p>
                <p className="mt-1 text-xs text-amber-700">Nearest existing names: {nearestSeries.length ? nearestSeries.map(n => <strong key={n}>{n}</strong>).reduce((prev, curr) => <>{prev}, {curr}</>) : "None"}</p>
                <label className="mt-3 flex items-start gap-2 text-sm font-medium text-amber-900">
                  <input data-testid="checkbox-confirm-series" type="checkbox" className="mt-1" checked={newSeriesConfirmed} onChange={e => { setNewSeriesConfirmed(e.target.checked); change(); }} disabled={apply.isPending} />
                  I confirm this is deliberately a new series and not a typo.
                </label>
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium">MRP <span className="text-destructive">*</span>
              <Input data-testid="input-mrp" type="number" min="0.01" step="0.01" disabled={apply.isPending} className="mt-1" value={value} onChange={e => { setValue(e.target.value); change(); }} />
            </label>
          </div>
          <div>
            <label className="block text-sm font-medium">Effective Date <span className="text-destructive">*</span>
              <Input data-testid="input-effective-date" type="date" disabled={apply.isPending} className="mt-1" value={effectiveDate} onChange={e => { setEffectiveDate(e.target.value); change(); }} />
            </label>
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium">Reason for creation <span className="text-destructive">*</span>
              <Textarea data-testid="textarea-reason" disabled={apply.isPending} className="mt-1" rows={3} value={remarks} onChange={e => { setRemarks(e.target.value); change(); }} placeholder="Why is this product being added?" />
            </label>
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <Button data-testid="button-preview" disabled={!canPreview || preview.isPending} onClick={runPreview}>
            {preview.isPending ? "Checking…" : "Review and confirm"}
          </Button>
        </div>

        {preview.isError && <p className="mt-3 text-sm text-destructive">{errorText(preview.error)}</p>}
        
        {snapshot && preview.data && (
          <div className="mt-4 rounded-lg border-2 border-[#2d7c78] bg-[#f2fbfa] p-4">
            <h3 className="font-semibold">Confirm creation</h3>
            <p className="mt-2 text-sm">
              <b>WILL CREATE</b> product <b>{preview.data.normalizedCode} ({snapshot.productName})</b> in <b>{snapshot.division} / {snapshot.category}</b> with an exact MRP of <b>{money(snapshot.mrp)}</b> in series <b>{snapshot.series}</b>, effective from <b>{date(snapshot.effectiveDate)}</b>.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">Reason: {snapshot.reason}</p>
            <div className="mt-2 text-sm text-muted-foreground">
              {preview.data.periodExists ? `Period exists (${preview.data.periodCount} products).` : "Period is new."} {preview.data.goesLiveImmediately ? "Goes live immediately." : "Scheduled for the future."}
            </div>
            
            {preview.data.unusualShape && (
              <label className="mt-3 flex items-start gap-2 text-sm font-medium text-amber-900 bg-amber-50 p-3 rounded border border-amber-200">
                <input data-testid="checkbox-confirm-unusual-code" type="checkbox" className="mt-1" checked={unusualCodeConfirmed} onChange={e => setUnusualCodeConfirmed(e.target.checked)} disabled={apply.isPending} />
                I confirm {preview.data.normalizedCode} is correct despite the unusual format.
              </label>
            )}
            
            <div className="mt-4 flex justify-end gap-2">
              <Button data-testid="button-back" variant="outline" onClick={() => setSnapshot(null)}>Back</Button>
              <Button data-testid="button-save" disabled={apply.isPending || (preview.data.unusualShape && !unusualCodeConfirmed)} onClick={saveChange}>{apply.isPending ? "Saving…" : "Confirm and save"}</Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function SavedResult({ result, onClear, invalidate }: { result: { id: number; message: string; itemCode: string; actor: string; createdAt: string; movedCompetitorRows: number[]; movedCompetitorDetails: any[] }; onClear: () => void; invalidate: () => void }) {
  const status = useGetPriceEditorNewProductUndoStatus(result.id);
  const undo = useUndoPriceEditorNewProduct();
  const deactivate = useDeactivatePriceEditorNewProduct();
  
  const [error, setError] = useState<string | null>(null);
  const [showUndoDialog, setShowUndoDialog] = useState(false);
  const [showDeactivateDialog, setShowDeactivateDialog] = useState(false);
  const [deactivateReason, setDeactivateReason] = useState("");

  const handleUndo = () => {
    setError(null);
    undo.mutate({ auditId: result.id }, { 
      onSuccess: () => { invalidate(); setShowUndoDialog(false); onClear(); },
      onError: e => setError(errorText(e))
    });
  };

  const handleDeactivate = () => {
    if (!deactivateReason.trim()) return;
    setError(null);
    deactivate.mutate({ auditId: result.id, data: { reason: deactivateReason.trim() } }, {
      onSuccess: () => { invalidate(); setShowDeactivateDialog(false); onClear(); },
      onError: e => setError(errorText(e))
    });
  };

  return (
    <>
      <Alert className="border-emerald-500/40 bg-emerald-50">
        <CheckCircle2 className="h-4 w-4 text-emerald-700" />
        <AlertTitle>Product Created</AlertTitle>
        <AlertDescription className="space-y-3">
          <div>
            <p>{result.message} <Link className="font-medium underline" href={productDetailHref(result.itemCode)}>Open product</Link></p>
            <p className="text-xs text-muted-foreground mt-1">
              Recorded by {result.actor} at {new Date(result.createdAt).toLocaleString()}.
            </p>
          </div>
          
          {result.movedCompetitorDetails && result.movedCompetitorDetails.length > 0 && (
            <div className="mt-2 text-xs text-muted-foreground">
              Moved {result.movedCompetitorDetails.length} competitor row(s) to this product:
              <ul className="list-disc pl-4 mt-1">
                {result.movedCompetitorDetails.map((detail, i) => (
                  <li key={i}>{detail.competitor} (Code: {detail.sourceCode}, Batch: {detail.batchId})</li>
                ))}
              </ul>
            </div>
          )}
          
          {error && <p className="text-destructive font-medium text-xs">{error}</p>}
          
          {status.isLoading ? <p className="text-xs text-muted-foreground">Checking undo status…</p> : status.data ? (
            <div className="flex items-center gap-3 pt-2">
              {status.data.canUndo ? (
                <Button data-testid="button-undo" size="sm" variant="outline" onClick={() => setShowUndoDialog(true)} disabled={undo.isPending || deactivate.isPending}>
                  <Undo2 className="mr-1 h-3 w-3" />Undo Creation
                </Button>
              ) : status.data.canDeactivate ? (
                <div className="flex items-center gap-3">
                  <Button data-testid="button-deactivate" size="sm" variant="outline" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setShowDeactivateDialog(true)} disabled={undo.isPending || deactivate.isPending}>
                    Deactivate Product
                  </Button>
                  <span className="text-xs text-muted-foreground">{status.data.reason}</span>
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">{status.data.reason || "Cannot be undone or deactivated."}</span>
              )}
            </div>
          ) : null}
        </AlertDescription>
      </Alert>

      <AlertDialog open={showUndoDialog} onOpenChange={setShowUndoDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Undo Product Creation?</AlertDialogTitle>
            <AlertDialogDescription>
              This will completely remove the product and its initial price from the database. This action cannot be reversed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleUndo}>Confirm Undo</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showDeactivateDialog} onOpenChange={setShowDeactivateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deactivate Product</DialogTitle>
            <DialogDescription>
              The product cannot be fully removed because it has dependencies. Provide a reason to deactivate it instead.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <label htmlFor="reason" className="text-sm font-medium">Deactivation Reason</label>
              <Textarea 
                id="reason" 
                value={deactivateReason} 
                onChange={(e) => setDeactivateReason(e.target.value)} 
                placeholder="Why is this product being deactivated?" 
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeactivateDialog(false)}>Cancel</Button>
            <Button onClick={handleDeactivate} disabled={!deactivateReason.trim()}>Deactivate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
