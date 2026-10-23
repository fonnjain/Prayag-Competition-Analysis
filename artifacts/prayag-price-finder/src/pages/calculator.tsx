import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Calculator, Check, Link2, ListChecks, Plus, RotateCcw, ShieldAlert } from "lucide-react";
import { useAuth } from "@workspace/replit-auth-web";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  MAX_CALCULATOR_BLOCKS,
  calculatorDisclosures,
  CALCULATOR_SCOPE_DISCLOSURE,
  setBlockProduct,
  setBlockVariant,
  setCompetitor,
  isCalculatorDate,
  decodeCalculator,
  encodeCalculator,
  resolveCalculator,
  summarizeCalculator,
  type CalculatorBlock,
  type CalculatorState,
} from "@/lib/calculatorState";
import { downloadCalculatorExport, useCalculatorCompetitors, useCalculatorRows, useDiscountDefaults } from "@/lib/calculatorApi";
import { CalculatorBlockCard } from "@/components/calculator/CalculatorBlockCard";
import { AssertedBanner, CalculatorSummary } from "@/components/calculator/CalculatorSummary";

let idCounter = 0;
const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(idCounter++).toString(36)}`;

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function emptyBlock(discount = "0"): CalculatorBlock {
  return { id: newId("b"), itemCode: null, variant: "Standard", discount, quantity: "1", competitors: [] };
}

function rawCalcParam(search: string): string | null {
  return new URLSearchParams(search).get("calc");
}

function initialState(search: string): { state: CalculatorState; fromLink: boolean } {
  const decoded = decodeCalculator(rawCalcParam(search));
  if (decoded && decoded.blocks.length > 0) return { state: decoded, fromLink: true };
  return { state: { asOf: decoded?.asOf ?? todayIso(), blocks: [emptyBlock()] }, fromLink: false };
}

function allDiscountKeys(blocks: CalculatorBlock[]): Set<string> {
  const keys = new Set<string>();
  blocks.forEach((b) => {
    keys.add(`our:${b.id}`);
    b.competitors.forEach((c) => keys.add(`comp:${c.id}`));
  });
  return keys;
}

export default function CalculatorPage() {
  const searchString = useSearch();
  const [, setLocation] = useLocation();
  const { user, isLoading: authLoading } = useAuth();

  const init = useMemo(() => initialState(searchString), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [asOf, setAsOf] = useState(init.state.asOf);
  const [dateDraft, setDateDraft] = useState(init.state.asOf);
  const dateReady = isCalculatorDate(dateDraft) && dateDraft === asOf;
  useEffect(() => {
    if (!isCalculatorDate(dateDraft) || dateDraft === asOf) return;
    // Native date fields emit incomplete intermediate values while typing.
    // Resolve only the settled valid date, not every individual keystroke.
    const timer = setTimeout(() => setAsOf(dateDraft), 400);
    return () => clearTimeout(timer);
  }, [dateDraft, asOf]);
  const [blocks, setBlocks] = useState<CalculatorBlock[]>(init.state.blocks);
  // Discount cells the user (or a shared link) has set; defaults never overwrite these.
  const [touched, setTouched] = useState<Set<string>>(() => (init.fromLink ? allDiscountKeys(init.state.blocks) : new Set()));
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const blockRefs = useRef(new Map<string, HTMLElement>());
  const summaryRef = useRef<HTMLElement | null>(null);
  const pendingFocus = useRef<string | null>(init.fromLink ? null : init.state.blocks[0]?.id ?? null);

  // ---- Discount defaults: signed-in only, never called for anonymous viewers.
  const signedIn = !authLoading && !!user;
  const defaultsQuery = useDiscountDefaults(user?.id ?? null, signedIn);
  const defaults = useMemo(() => {
    const map = new Map<string, number>();
    (defaultsQuery.data ?? []).forEach((d) => map.set(d.scope, d.discountPct));
    return map;
  }, [defaultsQuery.data]);
  const defaultsReady = signedIn && defaultsQuery.isSuccess;
  const seedFor = useCallback(
    (scope: string) => (defaultsReady && defaults.has(scope) ? String(defaults.get(scope)) : "0"),
    [defaultsReady, defaults],
  );

  useEffect(() => {
    if (!defaultsReady) return;
    setBlocks((prev) =>
      prev.map((b) => ({
        ...b,
        discount: touched.has(`our:${b.id}`) ? b.discount : seedFor("Our"),
        competitors: b.competitors.map((c) =>
          touched.has(`comp:${c.id}`) || !c.competitor || c.adHoc ? c : { ...c, discount: seedFor(c.competitor) },
        ),
      })),
    );
    // Only re-seed when the defaults themselves arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultsReady, defaults]);

  const discountHint = useCallback(
    (scope: string, key: string) =>
      defaultsReady && !touched.has(key) && !defaults.has(scope) ? "no default set" : null,
    [defaultsReady, touched, defaults],
  );

  // ---- Evidence: unscoped full catalogue. Ad-hoc codes are never sent as evidence lookups.
  const codes = useMemo(
    // Even one-off codes are rechecked: an old/shared link cannot hide an exact
    // catalogue identity by claiming adHocProduct=true.
    () => [...new Set(blocks.map((b) => b.itemCode).filter((c): c is string => c != null))],
    [blocks],
  );
  const rowsQuery = useCalculatorRows(codes, asOf, dateReady);
  const competitorsQuery = useCalculatorCompetitors(asOf, dateReady);
  const knownCompetitors = useMemo(() => competitorsQuery.data?.competitors ?? [], [competitorsQuery.data]);
  const evidence = useMemo(() => rowsQuery.data?.rows ?? [], [rowsQuery.data]);
  const resolved = useMemo(() => resolveCalculator(blocks, evidence, rowsQuery.data?.catalogueCodes), [blocks, evidence, rowsQuery.data?.catalogueCodes]);
  const resolvedById = useMemo(() => new Map(resolved.map((r) => [r.block.id, r])), [resolved]);
  const evidenceByCode = useMemo(() => new Map(evidence.map((e) => [e.itemCode, e])), [evidence]);
  const unavailable = useMemo(() => new Set(rowsQuery.data?.unavailableCodes ?? []), [rowsQuery.data]);
  const summary = useMemo(() => summarizeCalculator(resolved), [resolved]);
  const disclosures = useMemo(
    () => calculatorDisclosures(summary, rowsQuery.data?.asOfDate ?? asOf, rowsQuery.data?.scopeDisclosure ?? [CALCULATOR_SCOPE_DISCLOSURE]),
    [summary, rowsQuery.data, asOf],
  );
  // A typed (explicit) price must be valid; an untouched missing app price simply stays out of totals.
  const hasValidProduct = dateReady && !rowsQuery.isFetching && resolved.some(r => r.product) &&
    resolved.every(r => !r.our.errors.discount && !r.our.errors.quantity &&
      !(r.our.errors.mrp && (r.block.mrp !== undefined || r.adHocProduct)) &&
      r.competitors.every(c => !c.errors.discount && !c.errors.quantity && !(c.errors.mrp && (c.mrp !== undefined || c.adHoc))));
  const assertedCount = summary.assertedPrices ?? 0;

  // ---- Share link (state stays in memory when too large).
  const encoded = useMemo(() => encodeCalculator({ asOf, blocks }), [asOf, blocks]);
  useEffect(() => {
    const current = rawCalcParam(searchString);
    if (encoded) {
      if (current !== encoded) setLocation(`/calculator?${new URLSearchParams({ calc: encoded })}`, { replace: true });
    } else if (current != null) {
      setLocation("/calculator", { replace: true });
    }
  }, [encoded, searchString, setLocation]);

  const copyLink = async () => {
    if (!encoded || !dateReady) return;
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    await navigator.clipboard.writeText(`${window.location.origin}${base}/calculator?${new URLSearchParams({ calc: encoded })}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  // ---- Focus + scroll for newly added blocks.
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    requestAnimationFrame(() => {
      blockRefs.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      document.getElementById(`calc-product-${id}`)?.focus({ preventScroll: true });
    });
  }, [blocks.length]);

  // ---- Mutators.
  const patchBlock = (id: string, patch: Partial<CalculatorBlock>) =>
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const replaceBlock = (id: string, fn: (b: CalculatorBlock) => CalculatorBlock) =>
    setBlocks((prev) => prev.map((b) => (b.id === id ? fn(b) : b)));
  const markTouched = (key: string) => setTouched((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));

  const addBlock = () => {
    if (blocks.length >= MAX_CALCULATOR_BLOCKS) return;
    const b = emptyBlock(seedFor("Our"));
    pendingFocus.current = b.id;
    setBlocks((prev) => [...prev, b]);
  };
  const removeBlock = (id: string) => setBlocks((prev) => {
    const next = prev.filter((b) => b.id !== id);
    if (next.length > 0) return next;
    const b = emptyBlock(seedFor("Our"));
    pendingFocus.current = b.id;
    return [b];
  });
  const doReset = () => {
    const b = emptyBlock(seedFor("Our"));
    pendingFocus.current = b.id;
    setTouched(new Set());
    setSummaryOpen(false);
    setAsOf(todayIso());
    setDateDraft(todayIso());
    setBlocks([b]);
  };

  const openSummary = () => {
    setSummaryOpen(true);
    requestAnimationFrame(() => {
      summaryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      summaryRef.current?.focus({ preventScroll: true });
    });
  };

  const runExport = async (format: "xlsx" | "pdf" = "xlsx") => {
    setExporting(true);
    setExportError(null);
    try {
      await downloadCalculatorExport(asOf, blocks.filter((b) => b.itemCode), format);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  const atBlockCap = blocks.length >= MAX_CALCULATOR_BLOCKS;

  return (
    <div className="flex min-h-full flex-col bg-slate-50 dark:bg-background print:bg-transparent">
      <div className="shrink-0 bg-gradient-to-r from-indigo-950 via-slate-900 to-slate-900 text-white print:bg-none print:text-foreground">
        <div className="mx-auto max-w-[1400px] px-4 py-3 md:px-6 md:py-4">
          <h1 className="mb-2 text-xl font-black tracking-tight text-white md:text-2xl print:text-foreground">Price Calculator</h1>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <p className="max-w-2xl text-xs font-medium text-indigo-200 print:text-muted-foreground" data-testid="text-discount-hint">
              {signedIn
                ? "Discounts pre-filled from saved settings. Edit any cell to override — nothing here changes the saved settings."
                : "Enter your discount and the competitor's to compare net prices."}
            </p>
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-slate-800/80 p-2 print:hidden">
              <Label htmlFor="calc-asof" className="text-xs font-semibold text-slate-300">As of</Label>
              {!isCalculatorDate(dateDraft) && <span role="alert" className="text-xs text-rose-300">Enter a complete, valid date.</span>}
              <Input
                id="calc-asof"
                type="date"
                value={dateDraft}
                min="0001-01-01"
                max="9999-12-31"
                aria-invalid={!isCalculatorDate(dateDraft)}
                onChange={(e) => setDateDraft(e.target.value)}
                onBlur={() => { if (isCalculatorDate(dateDraft)) setAsOf(dateDraft); }}
                data-testid="input-calculator-asof"
                className="h-8 w-[140px] border-white/10 bg-slate-950/50 text-xs font-medium text-white focus-visible:ring-indigo-500"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={encoded ? -1 : 0} className="inline-flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={!encoded || !dateReady}
                      onClick={copyLink}
                      data-testid="button-copy-link"
                      className="h-8 gap-1.5 border border-white/20 text-xs font-bold text-white hover:bg-white/10 hover:text-white"
                    >
                      {copied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
                      {copied ? "Copied" : "Copy link"}
                    </Button>
                    {!encoded && <span className="text-[11px] font-semibold text-amber-300" data-testid="text-link-too-large">Too large to share by link</span>}
                  </span>
                </TooltipTrigger>
                {!dateReady ? <TooltipContent>Complete a valid as-of date and wait for current prices.</TooltipContent> : !encoded && <TooltipContent>This calculation is kept in this tab only. Remove blocks or competitors to share it.</TooltipContent>}
              </Tooltip>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setConfirmReset(true)}
                data-testid="button-reset-calculator"
                className="h-8 gap-1.5 text-xs font-bold text-slate-200 hover:bg-white/10 hover:text-white"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reset
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1400px] flex-1 space-y-3 px-2.5 py-3 md:px-6 md:py-4">
        {signedIn && defaultsQuery.isError && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 dark:bg-amber-950/30 dark:text-amber-200" data-testid="notice-defaults-error">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Saved discounts could not be loaded. Every discount starts at 0 — enter them by hand.
              <button type="button" onClick={() => defaultsQuery.refetch()} className="ml-2 underline underline-offset-2">Retry</button>
            </span>
          </div>
        )}
        {rowsQuery.isError && (
          <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
            Prices could not be loaded. Totals are not shown until they are.
            <button type="button" onClick={() => rowsQuery.refetch()} className="ml-2 underline underline-offset-2">Retry</button>
          </div>
        )}
        <ul className="rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2 text-xs text-indigo-900 dark:border-indigo-900/40 dark:bg-indigo-950/20 dark:text-indigo-200" data-testid="list-scope-disclosure">
          {(rowsQuery.data?.scopeDisclosure ?? [CALCULATOR_SCOPE_DISCLOSURE]).map((line, i) => <li key={i}>{line}</li>)}
        </ul>

        {!hasValidProduct && blocks.length === 1 && !blocks[0].itemCode && (
          <p className="flex items-center gap-2 px-1 text-sm text-muted-foreground" data-testid="text-calculator-empty">
            <Calculator className="h-4 w-4 shrink-0 text-indigo-500" />
            Pick a product, set your discount and quantity, then add the competitors you want to price against.
          </p>
        )}

        {blocks.map((block, index) => (
          <CalculatorBlockCard
            key={block.id}
            ref={(el) => { if (el) blockRefs.current.set(block.id, el); else blockRefs.current.delete(block.id); }}
            block={block}
            index={index}
            asOf={asOf}
            resolved={resolvedById.get(block.id)}
            product={block.itemCode ? evidenceByCode.get(block.itemCode) : undefined}
            evidenceLoading={rowsQuery.isFetching}
            unavailable={!!block.itemCode && unavailable.has(block.itemCode)}
            knownCompetitors={knownCompetitors}
            competitorsLoading={competitorsQuery.isLoading}
            competitorsError={competitorsQuery.isError}
            onRetryCompetitors={() => competitorsQuery.refetch()}
            discountHint={discountHint}
            onPatch={(patch) => patchBlock(block.id, patch)}
            onProduct={(choice) => {
              if (choice && !choice.adHoc && !block.adHocProduct && choice.itemCode === block.itemCode) return;
              // New product: Standard variant, no carried-over brands or price overrides.
              replaceBlock(block.id, (b) => setBlockProduct(b, choice));
            }}
            onVariant={(variant) => replaceBlock(block.id, (b) => setBlockVariant(b, variant))}
            onMrp={(value) => replaceBlock(block.id, (b) => {
              const { mrp: _m, ...rest } = b; // eslint-disable-line @typescript-eslint/no-unused-vars
              return value === undefined ? rest : { ...rest, mrp: value };
            })}
            onCompetitorMrp={(cid, value) => patchBlock(block.id, {
              competitors: block.competitors.map((c) => {
                if (c.id !== cid) return c;
                const { mrp: _m, ...rest } = c; // eslint-disable-line @typescript-eslint/no-unused-vars
                return value === undefined ? rest : { ...rest, mrp: value };
              }),
            })}
            onDiscount={(value) => { markTouched(`our:${block.id}`); patchBlock(block.id, { discount: value }); }}
            onCompetitorDiscount={(cid, value) => {
              markTouched(`comp:${cid}`);
              patchBlock(block.id, { competitors: block.competitors.map((c) => (c.id === cid ? { ...c, discount: value } : c)) });
            }}
            onCompetitorBrand={(cid, brand, adHoc) =>
              patchBlock(block.id, {
                competitors: block.competitors.map((c) =>
                  c.id === cid
                    ? { ...setCompetitor(c, brand, adHoc), discount: touched.has(`comp:${cid}`) || adHoc ? c.discount : seedFor(brand) }
                    : c,
                ),
              })
            }
            onAddCompetitor={() =>
              patchBlock(block.id, { competitors: [...block.competitors, { id: newId("c"), competitor: null, discount: "0" }] })
            }
            onRemoveCompetitor={(cid) => patchBlock(block.id, { competitors: block.competitors.filter((c) => c.id !== cid) })}
            onRemove={() => removeBlock(block.id)}
          />
        ))}

        {assertedCount > 0 && !summaryOpen && <AssertedBanner count={assertedCount} />}
        {summaryOpen && hasValidProduct && (
          <CalculatorSummary
            ref={summaryRef}
            rows={resolved}
            summary={summary}
            disclosures={disclosures}
            onExport={() => runExport("xlsx")}
            onPdf={() => runExport("pdf")}
            exporting={exporting}
            exportError={exportError}
          />
        )}
      </div>

      <div className="sticky bottom-0 z-20 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 print:hidden">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-2 px-2.5 py-2 md:px-6">
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={atBlockCap ? 0 : -1} className="inline-block">
                <Button type="button" variant="outline" size="sm" onClick={addBlock} disabled={atBlockCap} data-testid="button-add-product" className="h-9 gap-1.5 font-semibold">
                  <Plus className="h-4 w-4" /> Add product
                </Button>
              </span>
            </TooltipTrigger>
            {atBlockCap && <TooltipContent>The calculator holds at most {MAX_CALCULATOR_BLOCKS} products, matching the comparison limit.</TooltipContent>}
          </Tooltip>
          <span className="text-xs text-muted-foreground tabular-nums" data-testid="text-block-count">
            {blocks.length} products · {MAX_CALCULATOR_BLOCKS} max
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={hasValidProduct ? -1 : 0} className="ml-auto inline-block">
                <Button
                  type="button"
                  size="sm"
                  onClick={openSummary}
                  disabled={!hasValidProduct}
                  data-testid="button-final-summary"
                  className="h-9 gap-1.5 bg-indigo-600 font-bold text-white hover:bg-indigo-500"
                >
                  <ListChecks className="h-4 w-4" /> Final Summary
                </Button>
              </span>
            </TooltipTrigger>
            {!hasValidProduct && <TooltipContent>Choose an available product, wait for current prices and correct invalid inputs first.</TooltipContent>}
          </Tooltip>
        </div>
      </div>

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear the whole calculation?</AlertDialogTitle>
            <AlertDialogDescription>
              Every block, discount and competitor on this page will be removed. Nothing saved elsewhere is affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-reset">Keep working</AlertDialogCancel>
            <AlertDialogAction onClick={doReset} data-testid="button-confirm-reset">Clear all</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
