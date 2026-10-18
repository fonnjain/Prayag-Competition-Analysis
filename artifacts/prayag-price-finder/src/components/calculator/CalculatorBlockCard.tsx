import { forwardRef, useState } from "react";
import { AlertTriangle, Info, PenLine, Plus, Trash2, X } from "lucide-react";
import { formatMoney } from "@workspace/formatting";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { formatPriceDate } from "@/components/price-window";
import {
  MAX_CALCULATOR_COMPETITORS,
  competitorIdentity,
  type CalculatorBlock,
  type CalculatorEvidence,
  type ProductChoice,
  type ResolvedCalculator,
} from "@/lib/calculatorState";
import { ProductPicker } from "./ProductPicker";
import { CompetitorPicker, type KnownCompetitor } from "./CompetitorPicker";
import { AdHocBadge, MrpField, type PriceState } from "./MrpField";
import { Cell, NumericField, PositionBadge } from "./shared";

export const ADHOC_COMPETITOR_NOTE = "price entered by user — basis and unit unverified";

export type BlockCardProps = {
  block: CalculatorBlock;
  index: number;
  asOf: string;
  resolved: ResolvedCalculator[number] | undefined;
  product: CalculatorEvidence | undefined;
  evidenceLoading: boolean;
  unavailable: boolean;
  knownCompetitors: KnownCompetitor[];
  competitorsLoading: boolean;
  competitorsError: boolean;
  onRetryCompetitors: () => void;
  discountHint: (scope: string, touchedKey: string) => string | null;
  onPatch: (patch: Partial<CalculatorBlock>) => void;
  onProduct: (choice: ProductChoice | null) => void;
  onVariant: (variant: string) => void;
  onMrp: (value: string | undefined) => void;
  onDiscount: (value: string) => void;
  onCompetitorDiscount: (competitorId: string, value: string) => void;
  onCompetitorMrp: (competitorId: string, value: string | undefined) => void;
  onCompetitorBrand: (competitorId: string, brand: string, adHoc: boolean) => void;
  onAddCompetitor: () => void;
  onRemoveCompetitor: (competitorId: string) => void;
  onRemove: () => void;
};

const QTY_TOOLTIP = "Quantity follows the Prayag row so the comparison stays like-for-like.";
const fallbackState = (value: string | undefined, app: number | null): PriceState =>
  app == null ? "Entered" : value === undefined ? "App" : "Edited";

export const CalculatorBlockCard = forwardRef<HTMLElement, BlockCardProps>(function CalculatorBlockCard(props, ref) {
  const { block, index, asOf, resolved, product, evidenceLoading, unavailable } = props;
  const [editingBrand, setEditingBrand] = useState<string | null>(null);
  const code = block.itemCode;
  const adHocProduct = resolved?.adHocProduct ?? !!block.adHocProduct;
  const taken = new Set(block.competitors.filter((c) => c.competitor).map(competitorIdentity));
  const atCap = block.competitors.length >= MAX_CALCULATOR_COMPETITORS;

  const variants = adHocProduct ? [] : product?.variants ?? [];
  const showVariants = variants.length > 1 || variants.some((v) => v.variant !== "Standard");
  const our = resolved?.our;
  const ourApp = our?.appPrice ?? (adHocProduct ? null : resolved?.price?.price ?? null);
  const ourState: PriceState = our?.priceState ?? fallbackState(block.mrp, ourApp);
  const name = adHocProduct ? block.description ?? "" : product?.productName ?? resolved?.product?.productName ?? null;
  const label = code ? `${code} · ${name || "Unnamed product"}` : undefined;
  const n = index + 1;
  const productKnown = adHocProduct || !!product;

  const addDisabledReason = !code
    ? "Choose a product first."
    : atCap
      ? `A block can compare at most ${MAX_CALCULATOR_COMPETITORS} competitors.`
      : block.competitors.some((c) => !c.competitor)
        ? "Choose a competitor in the empty row first."
        : null;

  return (
    <section
      ref={ref}
      aria-label={`Block ${n}${code ? `: ${code}` : ""}`}
      data-testid={`block-${block.id}`}
      className="scroll-mt-24 rounded-xl border border-border bg-card shadow-sm break-inside-avoid"
    >
      <div className="flex items-center gap-3 border-b bg-slate-50/80 px-3 py-2 dark:bg-muted/30 md:px-4">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-indigo-950 text-xs font-black text-white" aria-hidden>
          {n}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Our product</span>
        {adHocProduct && <AdHocBadge label="Ad-hoc product" testId={`badge-adhoc-product-${block.id}`} />}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={props.onRemove}
          aria-label={`Remove block ${n}`}
          data-testid={`button-remove-block-${block.id}`}
          className="ml-auto h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-destructive print:hidden"
        >
          <Trash2 className="h-3.5 w-3.5" /> Remove
        </Button>
      </div>

      <div className="space-y-3 p-3 md:p-4">
        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-end">
          <ProductPicker
            blockId={block.id}
            index={index}
            asOf={asOf}
            itemCode={adHocProduct ? null : code}
            selectedLabel={adHocProduct ? undefined : label}
            onChange={props.onProduct}
          />
          {showVariants && (
            <SearchableSelect
              aria-label={`Variant for block ${n}`}
              data-testid={`select-variant-${block.id}`}
              widthClass="w-full"
              placeholder="Variant"
              searchPlaceholder="Search variants…"
              emptyText="No variant matches"
              value={block.variant}
              options={variants.map((v) => ({
                value: v.variant,
                label: v.variant,
                hint: v.price == null ? "No price" : `${formatMoney(v.price)} from ${formatPriceDate(v.effectiveDate)}`,
              }))}
              onChange={(next) => next && next !== block.variant && props.onVariant(next)}
            />
          )}
        </div>

        {code && unavailable && !adHocProduct && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 dark:bg-amber-950/30 dark:text-amber-200" role="status">
            {code} could not be resolved for this date. It is excluded from totals.
          </p>
        )}

        {/* Our row */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-indigo-100 bg-indigo-50/40 p-3 dark:border-indigo-900/40 dark:bg-indigo-950/20 sm:grid-cols-3 lg:grid-cols-[minmax(0,1.6fr)_repeat(5,minmax(0,1fr))]">
          <Cell label="Item" className="col-span-2 sm:col-span-3 lg:col-span-1">
            {code && productKnown ? (
              <div className="min-w-0">
                <span className="block font-mono text-xs font-black text-primary whitespace-pre" data-testid={`text-item-code-${block.id}`}>{code}</span>
                <span className="block truncate text-sm font-semibold" title={name ?? undefined}>{name || "Unnamed product"}</span>
                <span className="block text-[10px] text-muted-foreground" data-testid={`text-group-${block.id}`}>
                  {adHocProduct ? "Ad-hoc · no division or category" : [product?.division, product?.category].filter(Boolean).join(" · ") || "Division not recorded"}
                </span>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">{evidenceLoading && code ? "Loading price…" : "No product chosen"}</span>
            )}
          </Cell>
          <Cell label={block.variant === "Standard" ? "MRP" : `MRP · ${block.variant}`}>
            {evidenceLoading && code && !productKnown ? (
              <span className="block h-8 w-20 rounded bg-muted animate-pulse" />
            ) : code && productKnown ? (
              <MrpField
                id={`calc-mrp-${block.id}`}
                value={block.mrp}
                appPrice={ourApp}
                state={ourState}
                error={our?.errors.mrp}
                onChange={props.onMrp}
                date={resolved?.price?.effectiveDate ? formatPriceDate(resolved.price.effectiveDate) : null}
                ariaLabel={`Our MRP, block ${n}`}
                testId={`input-mrp-${block.id}`}
              />
            ) : <span className="text-sm text-muted-foreground">—</span>}
          </Cell>
          <Cell label="Disc %">
            <NumericField
              id={`calc-disc-${block.id}`}
              value={block.discount}
              onChange={props.onDiscount}
              error={our?.errors.discount ?? null}
              hint={props.discountHint("Our", `our:${block.id}`)}
              suffix="%"
              ariaLabel={`Our discount percent, block ${n}`}
              testId={`input-discount-${block.id}`}
            />
          </Cell>
          <Cell label="Net">
            <span className="block font-mono text-sm font-semibold tabular-nums" data-testid={`text-our-net-${block.id}`}>{formatMoney(our?.netUnit)}</span>
          </Cell>
          <Cell label="Qty">
            <NumericField
              id={`calc-qty-${block.id}`}
              value={block.quantity}
              onChange={(v) => props.onPatch({ quantity: v })}
              error={our?.errors.quantity ?? null}
              inputMode="numeric"
              ariaLabel={`Quantity, block ${n}`}
              testId={`input-quantity-${block.id}`}
            />
          </Cell>
          <Cell label="Total">
            <span className="block font-mono text-base font-black tabular-nums text-indigo-950 dark:text-indigo-100" data-testid={`text-our-total-${block.id}`}>
              {formatMoney(our?.total)}
            </span>
          </Cell>
        </div>

        {/* Competitor rows */}
        {block.competitors.length > 0 && (
          <div className="space-y-2" aria-label={`Competitors for block ${n}`}>
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Competitor</div>
            {block.competitors.map((c) => {
              const r = resolved?.competitors.find((x) => x.id === c.id);
              const app = c.adHoc ? null : r?.appPrice ?? r?.quote?.price ?? null;
              const state: PriceState = r?.priceState ?? fallbackState(c.mrp, app);
              const picking = !c.competitor || editingBrand === c.id;
              const notes = (r?.notes ?? []).filter((x) => x.toLowerCase() !== ADHOC_COMPETITOR_NOTE);
              const warnings = c.adHoc ? [] : [
                ...(r?.basisMismatch ? [r.basisWarning] : []),
                ...(r?.unitMismatch ? [`Unit: ${r.quote?.unit}`] : []),
                ...(r?.variantMismatch ? [r.variantWarning] : []),
              ].filter(Boolean);
              return (
                <div
                  key={c.id}
                  data-testid={`row-competitor-${c.id}`}
                  data-adhoc={c.adHoc ? "true" : undefined}
                  className={`grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border p-3 sm:grid-cols-3 lg:grid-cols-[minmax(0,1.6fr)_repeat(5,minmax(0,1fr))_auto] ${c.adHoc ? "border-dashed border-fuchsia-300 dark:border-fuchsia-900/60" : ""}`}
                >
                  <Cell label="Brand" className="col-span-2 sm:col-span-3 lg:col-span-1">
                    {picking ? (
                      <CompetitorPicker
                        id={c.id}
                        known={props.knownCompetitors}
                        loading={props.competitorsLoading}
                        error={props.competitorsError}
                        onRetry={props.onRetryCompetitors}
                        taken={taken}
                        autoFocus
                        onPick={(brand, adHoc) => { setEditingBrand(null); props.onCompetitorBrand(c.id, brand, adHoc); }}
                        onCancel={c.competitor ? () => setEditingBrand(null) : undefined}
                      />
                    ) : (
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-bold" data-testid={`text-competitor-name-${c.id}`}>{c.competitor}</span>
                        {c.adHoc ? <AdHocBadge testId={`badge-adhoc-competitor-${c.id}`} /> : null}
                        <button type="button" onClick={() => setEditingBrand(c.id)} className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-muted-foreground hover:text-foreground print:hidden" data-testid={`button-change-competitor-${c.id}`}>
                          <PenLine className="h-3 w-3" /> Change
                        </button>
                      </div>
                    )}
                    {!picking && !!notes.length && (
                      <span className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground" data-testid={`note-unit-${c.id}`}>
                        <Info className="h-3 w-3 shrink-0" /> {notes.join(" ")}
                      </span>
                    )}
                    {!picking && c.adHoc && (
                      <>
                        {!notes.length && (
                          <span className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground" data-testid={`note-unit-${c.id}`}>
                            <Info className="h-3 w-3 shrink-0" /> Unit not recorded.
                          </span>
                        )}
                        <span className="mt-1 flex items-center gap-1 text-[10px] font-semibold italic text-fuchsia-800 dark:text-fuchsia-300" data-testid={`note-adhoc-${c.id}`}>
                          <PenLine className="h-3 w-3 shrink-0" /> {ADHOC_COMPETITOR_NOTE}
                        </span>
                      </>
                    )}
                    {!picking && warnings.length > 0 && (
                      <span className="mt-1.5 inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200" data-testid={`badge-basis-${c.id}`}>
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        <span className="whitespace-pre-wrap">{warnings.join(" ")}</span>
                      </span>
                    )}
                  </Cell>
                  <Cell label="MRP">
                    {c.competitor ? (
                      <MrpField
                        id={`calc-cmrp-${c.id}`}
                        value={c.mrp}
                        appPrice={app}
                        state={state}
                        error={r?.errors.mrp}
                        onChange={(v) => props.onCompetitorMrp(c.id, v)}
                        date={!c.adHoc && r?.quote?.effectiveDate ? formatPriceDate(r.quote.effectiveDate) : null}
                        ariaLabel={`${c.competitor} MRP, block ${n}`}
                        testId={`input-competitor-mrp-${c.id}`}
                      />
                    ) : <span className="text-sm text-muted-foreground">—</span>}
                  </Cell>
                  <Cell label="Disc %">
                    <NumericField
                      id={`calc-cdisc-${c.id}`}
                      value={c.discount}
                      onChange={(v) => props.onCompetitorDiscount(c.id, v)}
                      error={r?.errors.discount ?? null}
                      hint={c.competitor && !c.adHoc ? props.discountHint(c.competitor, `comp:${c.id}`) : null}
                      suffix="%"
                      ariaLabel={`${c.competitor ?? "Competitor"} discount percent, block ${n}`}
                      testId={`input-competitor-discount-${c.id}`}
                    />
                  </Cell>
                  <Cell label="Net">
                    <span className="block font-mono text-sm font-semibold tabular-nums" data-testid={`text-competitor-net-${c.id}`}>{formatMoney(r?.netUnit)}</span>
                  </Cell>
                  <Cell label="Qty">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          tabIndex={0}
                          aria-label={`Quantity ${our?.quantity ?? block.quantity}, same as ours. ${QTY_TOOLTIP}`}
                          data-testid={`text-competitor-qty-${c.id}`}
                          className="inline-flex items-center gap-1 font-mono text-sm tabular-nums text-muted-foreground"
                        >
                          {our?.quantity ?? block.quantity} <Info className="h-3 w-3" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">{QTY_TOOLTIP}</TooltipContent>
                    </Tooltip>
                  </Cell>
                  <Cell label="Total / position">
                    <span className="block font-mono text-sm font-bold tabular-nums" data-testid={`text-competitor-total-${c.id}`}>{formatMoney(r?.total)}</span>
                    {r && c.competitor && (
                      <PositionBadge
                        direction={r.position.direction}
                        label={r.position.direction === "missing" ? "No price" : `${r.position.label}${r.position.diffUnit != null ? ` (${formatMoney(Math.abs(r.position.diffUnit))}/unit)` : ""}`}
                        className="mt-1"
                        testId={`text-position-${c.id}`}
                      />
                    )}
                  </Cell>
                  <div className="col-span-2 flex items-start justify-end sm:col-span-3 lg:col-span-1 print:hidden">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => props.onRemoveCompetitor(c.id)}
                      aria-label={`Remove ${c.competitor ?? "competitor row"} from block ${n}`}
                      data-testid={`button-remove-competitor-${c.id}`}
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 print:hidden">
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={addDisabledReason ? 0 : -1} className="inline-block">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!!addDisabledReason}
                  onClick={props.onAddCompetitor}
                  data-testid={`button-add-competitor-${block.id}`}
                  className="h-8 gap-1.5 text-xs font-semibold"
                >
                  <Plus className="h-3.5 w-3.5" /> Add competitor
                </Button>
              </span>
            </TooltipTrigger>
            {addDisabledReason && <TooltipContent>{addDisabledReason}</TooltipContent>}
          </Tooltip>
          {code && product && !adHocProduct && product.hasRecordedCompetitorPrice === false && (
            <span className="text-xs italic text-muted-foreground" data-testid={`text-no-competitors-${block.id}`}>
              No competitor prices recorded for this product. You can still add one and enter its price.
            </span>
          )}
        </div>
      </div>
    </section>
  );
});
