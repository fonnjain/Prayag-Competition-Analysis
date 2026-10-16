import { forwardRef } from "react";
import { AlertTriangle, Info, Plus, Trash2, X } from "lucide-react";
import { formatMoney } from "@workspace/formatting";
import { useGetPriceFinderCompetitors, getGetPriceFinderCompetitorsQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { formatPriceDate } from "@/components/price-window";
import {
  MAX_CALCULATOR_COMPETITORS,
  type CalculatorBlock,
  type CalculatorEvidence,
  type ResolvedCalculator,
} from "@/lib/calculatorState";
import { ProductPicker } from "./ProductPicker";
import { Cell, NumericField, PositionBadge, PriceWithDate } from "./shared";

export type BlockCardProps = {
  block: CalculatorBlock;
  index: number;
  asOf: string;
  resolved: ResolvedCalculator[number] | undefined;
  product: CalculatorEvidence | undefined;
  evidenceLoading: boolean;
  unavailable: boolean;
  scopeKey: readonly unknown[];
  scopeReady: boolean;
  discountHint: (scope: string, touchedKey: string) => string | null;
  onPatch: (patch: Partial<CalculatorBlock>) => void;
  onProduct: (itemCode: string | null) => void;
  onDiscount: (value: string) => void;
  onCompetitorDiscount: (competitorId: string, value: string) => void;
  onCompetitorBrand: (competitorId: string, brand: string) => void;
  onAddCompetitor: () => void;
  onRemoveCompetitor: (competitorId: string) => void;
  onRemove: () => void;
};

const QTY_TOOLTIP = "Quantity follows the Prayag row so the comparison stays like-for-like.";

export const CalculatorBlockCard = forwardRef<HTMLElement, BlockCardProps>(function CalculatorBlockCard(props, ref) {
  const { block, index, asOf, resolved, product, evidenceLoading, unavailable } = props;
  const code = block.itemCode;
  const coverageParams = { itemCode: code ? [code] : [], asOf: asOf || undefined };
  const coverage = useGetPriceFinderCompetitors(coverageParams, {
    query: {
      queryKey: [...getGetPriceFinderCompetitorsQueryKey(coverageParams), ...props.scopeKey],
      enabled: !!code && props.scopeReady,
    },
  });
  const covered = (coverage.data?.competitors ?? []).filter((c) => c.pricedProducts > 0);
  const chosen = new Set(block.competitors.map((c) => c.competitor).filter(Boolean) as string[]);
  const remaining = covered.filter((c) => !chosen.has(c.competitor));
  const atCap = block.competitors.length >= MAX_CALCULATOR_COMPETITORS;
  const noneRecorded = !!code && coverage.isSuccess && covered.length === 0;

  const variants = product?.variants ?? [];
  const showVariants = variants.length > 1 || variants.some((v) => v.variant !== "Standard");
  const our = resolved?.our;
  const ourPrice = resolved?.price;
  const label = product ? `${product.itemCode} · ${product.productName ?? "Unnamed product"}` : undefined;
  const n = index + 1;

  const addDisabledReason = !code
    ? "Choose a product first."
    : atCap
      ? `A block can compare at most ${MAX_CALCULATOR_COMPETITORS} competitors.`
      : coverage.isLoading
        ? "Loading competitors for this product…"
        : remaining.length === 0 || block.competitors.some((c) => !c.competitor)
          ? remaining.length === 0 ? "Every competitor with a price for this product is already added." : "Choose a brand in the empty row first."
          : null;

  return (
    <section
      ref={ref}
      aria-label={`Block ${n}${product ? `: ${product.itemCode}` : ""}`}
      data-testid={`block-${block.id}`}
      className="scroll-mt-24 rounded-xl border border-border bg-card shadow-sm break-inside-avoid"
    >
      <div className="flex items-center gap-3 border-b bg-slate-50/80 px-3 py-2 dark:bg-muted/30 md:px-4">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-indigo-950 text-xs font-black text-white" aria-hidden>
          {n}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Our product</span>
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
            itemCode={code}
            selectedLabel={label}
            onChange={props.onProduct}
            scopeKey={props.scopeKey}
            scopeReady={props.scopeReady}
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
              onChange={(next) => next && props.onPatch({ variant: next })}
            />
          )}
        </div>

        {code && unavailable && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 dark:bg-amber-950/30 dark:text-amber-200" role="status">
            {code} is not available under the current date or bucket scope. It is excluded from totals.
          </p>
        )}

        {/* Our row */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-indigo-100 bg-indigo-50/40 p-3 dark:border-indigo-900/40 dark:bg-indigo-950/20 sm:grid-cols-3 lg:grid-cols-[minmax(0,1.6fr)_repeat(5,minmax(0,1fr))]">
          <Cell label="Item" className="col-span-2 sm:col-span-3 lg:col-span-1">
            {product ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="min-w-0" tabIndex={0}>
                    <span className="block font-mono text-xs font-black text-primary" data-testid={`text-item-code-${block.id}`}>{product.itemCode}</span>
                    <span className="block truncate text-sm font-semibold">{product.productName ?? "Unnamed product"}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-sm">{product.productName ?? product.itemCode}</TooltipContent>
              </Tooltip>
            ) : (
              <span className="text-sm text-muted-foreground">{evidenceLoading && code ? "Loading price…" : "No product chosen"}</span>
            )}
          </Cell>
          <Cell label={block.variant === "Standard" ? "MRP" : `MRP · ${block.variant}`}>
            {evidenceLoading && code && !product ? (
              <span className="block h-4 w-16 rounded bg-muted animate-pulse" />
            ) : (
              <PriceWithDate
                price={ourPrice?.price != null ? formatMoney(ourPrice.price) : null}
                date={ourPrice?.effectiveDate ?? null}
                missing={product ? (ourPrice ? "No price" : "No price for this variant") : "—"}
              />
            )}
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
              const options = covered
                .filter((o) => o.competitor === c.competitor || !chosen.has(o.competitor))
                .map((o) => ({
                  value: o.competitor,
                  label: o.competitor,
                  hint: o.effectiveDate ? `Price from ${formatPriceDate(o.effectiveDate)}` : undefined,
                }));
              return (
                <div
                  key={c.id}
                  data-testid={`row-competitor-${c.id}`}
                  className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border p-3 sm:grid-cols-3 lg:grid-cols-[minmax(0,1.6fr)_repeat(5,minmax(0,1fr))_auto]"
                >
                  <Cell label="Brand" className="col-span-2 sm:col-span-3 lg:col-span-1">
                    <SearchableSelect
                      aria-label={`Competitor brand, block ${n}`}
                      data-testid={`select-competitor-${c.id}`}
                      widthClass="w-full"
                      triggerClassName="h-8"
                      placeholder={coverage.isLoading ? "Loading…" : "Choose competitor"}
                      searchPlaceholder="Search competitors…"
                      emptyText="No other competitor has a price for this product"
                      value={c.competitor}
                      options={options}
                      onChange={(next) => next && props.onCompetitorBrand(c.id, next)}
                    />
                    {!!r?.warnings.length && (
                      <span className="mt-1.5 inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200" data-testid={`badge-basis-${c.id}`}>
                        <AlertTriangle className="h-3 w-3 shrink-0" /> {r.warnings.join(" ")}
                      </span>
                    )}
                  </Cell>
                  <Cell label="MRP">
                    {c.competitor ? (
                      <PriceWithDate price={r?.quote?.price != null ? formatMoney(r.quote.price) : null} date={r?.quote?.effectiveDate ?? null} />
                    ) : <span className="text-sm text-muted-foreground">—</span>}
                  </Cell>
                  <Cell label="Disc %">
                    <NumericField
                      id={`calc-cdisc-${c.id}`}
                      value={c.discount}
                      onChange={(v) => props.onCompetitorDiscount(c.id, v)}
                      error={r?.errors.discount ?? null}
                      hint={c.competitor ? props.discountHint(c.competitor, `comp:${c.id}`) : null}
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

        <div className="print:hidden">
          {noneRecorded ? (
            <p className="text-xs italic text-muted-foreground" data-testid={`text-no-competitors-${block.id}`}>
              No competitor prices recorded for this product.
            </p>
          ) : coverage.isError ? (
            <button type="button" onClick={() => coverage.refetch()} className="text-xs font-semibold text-destructive underline underline-offset-2">
              Could not load competitors. Retry
            </button>
          ) : (
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
          )}
        </div>
      </div>
    </section>
  );
});
