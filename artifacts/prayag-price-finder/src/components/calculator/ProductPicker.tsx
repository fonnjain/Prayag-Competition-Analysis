import { useEffect, useRef, useState } from "react";
import { Search, FolderTree, KeyRound, Check } from "lucide-react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useCalculatorSearch } from "@/lib/calculatorApi";
import type { ProductChoice } from "@/lib/calculatorState";
import { AdHocBadge } from "./MrpField";
import { CALCULATOR_SEARCH_LIMIT, productSearchResultNotice } from "@workspace/formatting";
import { CALCULATOR_MIN_QUERY_LENGTH, calculatorExactLookupSettled, calculatorSearchReady } from "@/lib/calculatorSearchPolicy";

type Mode = "direct" | "browse" | "exact";

export type ProductPickerProps = {
  blockId: string;
  index: number;
  asOf: string;
  itemCode: string | null;
  selectedLabel?: string;
  onChange: (choice: ProductChoice | null) => void;
};

const productLabel = (code: string, name: string | null) => `${code} · ${name ?? "Unnamed product"}`;
const UNCATEGORISED = "\u0000uncategorised";

function useDebounced(value: string, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/**
 * Three routes into the block product: search, division -> category -> product,
 * and exact code entry. Codes are never trimmed or case-folded; a near suggestion
 * resolves the row only if the user explicitly picks it.
 */
export function ProductPicker({ blockId, index, asOf, itemCode, selectedLabel, onChange }: ProductPickerProps) {
  const [mode, setMode] = useState<Mode>("direct");
  const [rawQuery, setRawQuery] = useState("");
  const query = useDebounced(rawQuery, 180);
  const [division, setDivision] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const settledCode = useDebounced(code, 250);
  const asOfParam = asOf || undefined;

  const directSearchReady = calculatorSearchReady(rawQuery) && calculatorSearchReady(query);
  const search = useCalculatorSearch({ q: query, limit: CALCULATOR_SEARCH_LIMIT, asOf: asOfParam }, mode === "direct" && directSearchReady);
  const divisions = useCalculatorSearch({ limit: 1, asOf: asOfParam }, mode === "browse");
  const categories = useCalculatorSearch({ division: division ?? undefined, limit: 1, asOf: asOfParam }, mode === "browse" && !!division);
  const products = useCalculatorSearch(
    { division: division ?? undefined, category: category === UNCATEGORISED ? "__uncategorised__" : category ?? undefined, limit: CALCULATOR_SEARCH_LIMIT, asOf: asOfParam },
    mode === "browse" && !!division && !!category,
  );
  const exactSearchReady = calculatorSearchReady(code) && calculatorSearchReady(settledCode);
  const exact = useCalculatorSearch({ q: settledCode, limit: 8, asOf: asOfParam }, mode === "exact" && exactSearchReady);
  const exactSettled = calculatorExactLookupSettled(code, settledCode, exact.isSuccess, exact.isFetching);
  const exactProduct = exactSettled && exactSearchReady ? exact.data?.exactProduct ?? null : null;
  const nearMatches = exactSettled && exactSearchReady && !exactProduct ? (exact.data?.results ?? []).filter((r) => r.itemCode !== code).slice(0, 4) : [];

  const descRef = useRef<HTMLInputElement | null>(null);

  const searchOptions = (directSearchReady ? search.data?.results ?? [] : []).map((r) => ({
    value: r.itemCode,
    label: productLabel(r.itemCode, r.productName),
    hint: [r.division, r.category].filter(Boolean).join(" · ") || undefined,
  }));
  const tabs: { m: Mode; label: string; Icon: typeof Search }[] = [
    { m: "direct", label: "Search", Icon: Search },
    { m: "browse", label: "Division / category", Icon: FolderTree },
    { m: "exact", label: "Exact code", Icon: KeyRound },
  ];

  return (
    <div className="min-w-0 space-y-2">
      <div role="tablist" aria-label={`Product selection method for block ${index + 1}`} className="inline-flex flex-wrap rounded-md border bg-muted/40 p-0.5 text-xs print:hidden">
        {tabs.map(({ m, label, Icon }) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            data-testid={`tab-picker-${m}-${blockId}`}
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              mode === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3 w-3" /> {label}
          </button>
        ))}
      </div>

      {mode === "direct" && (
        <SearchableSelect
          triggerId={`calc-product-${blockId}`}
          aria-label={`Product for block ${index + 1}`}
          data-testid={`select-product-${blockId}`}
          widthClass="w-full"
          placeholder="Search item code or product name…"
          searchPlaceholder={`Type at least ${CALCULATOR_MIN_QUERY_LENGTH} characters…`}
          emptyText={!calculatorSearchReady(rawQuery)
            ? `Type at least ${CALCULATOR_MIN_QUERY_LENGTH} characters to search`
            : search.isError ? "Search failed. Try again." : "No products match. Use Exact code to add one by hand."}
          serverFiltered
          renderLimit={CALCULATOR_SEARCH_LIMIT}
          resultsNotice={directSearchReady && search.data
            ? productSearchResultNotice(search.data.results.length, search.data.totalCount)
            : undefined}
          loading={calculatorSearchReady(rawQuery) && (search.isFetching || rawQuery !== query)}
          onSearchChange={setRawQuery}
          value={itemCode}
          selectedLabel={selectedLabel ?? itemCode ?? undefined}
          options={searchOptions}
          onChange={(next) => next != null && onChange({ itemCode: next, adHoc: false })}
        />
      )}

      {mode === "browse" && (
        <div className="grid gap-2 sm:grid-cols-3">
          <SearchableSelect
            aria-label={`Division for block ${index + 1}`}
            data-testid={`select-division-${blockId}`}
            widthClass="w-full"
            placeholder={divisions.isLoading ? "Loading…" : divisions.isError ? "Could not load" : "Division"}
            searchPlaceholder="Search divisions…"
            emptyText="No division matches"
            disabled={divisions.isLoading}
            value={division}
            options={(divisions.data?.divisions ?? []).map((d) => ({ value: d.division, label: d.division, count: d.count }))}
            onChange={(next) => { setDivision(next); setCategory(null); }}
          />
          <SearchableSelect
            aria-label={`Category for block ${index + 1}`}
            data-testid={`select-category-${blockId}`}
            widthClass="w-full"
            placeholder={!division ? "Pick a division first" : categories.isLoading ? "Loading…" : "Category"}
            searchPlaceholder="Search categories…"
            emptyText="No category matches"
            disabled={!division || categories.isLoading}
            value={category}
            options={(categories.data?.categories ?? []).map((c) => ({ value: c.category ?? UNCATEGORISED, label: c.label, count: c.count }))}
            onChange={(next) => setCategory(next)}
          />
          <SearchableSelect
            triggerId={`calc-product-${blockId}`}
            aria-label={`Product for block ${index + 1}`}
            data-testid={`select-browse-product-${blockId}`}
            renderLimit={CALCULATOR_SEARCH_LIMIT}
            resultsNotice={products.data
              ? productSearchResultNotice(products.data.results.length, products.data.totalCount)
              : undefined}
            widthClass="w-full"
            placeholder={!category ? "Pick a category first" : products.isLoading ? "Loading…" : "Product"}
            searchPlaceholder="Search item code or name…"
            emptyText="No products in this category"
            disabled={!category || products.isLoading}
            value={itemCode}
            selectedLabel={selectedLabel ?? itemCode ?? undefined}
            options={(products.data?.results ?? [])
              .filter((p) => category !== UNCATEGORISED || p.category == null)
              .map((p) => ({ value: p.itemCode, label: productLabel(p.itemCode, p.productName) }))}
            onChange={(next) => next != null && onChange({ itemCode: next, adHoc: false })}
          />
        </div>
      )}

      {mode === "exact" && (
        <div className="space-y-2 rounded-md border border-dashed bg-muted/20 p-2">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
            <Input
              id={`calc-product-${blockId}`}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Item code, exactly as printed"
              aria-label={`Exact item code for block ${index + 1}`}
              data-testid={`input-exact-code-${blockId}`}
              className="h-8 font-mono text-sm"
              spellCheck={false}
              autoComplete="off"
            />
            <p className="self-center text-[11px] text-muted-foreground">
              Matched character for character. Spaces, dashes and capitals count.
            </p>
          </div>
          {code.length > 0 && !exactSettled && !(exactSearchReady && exact.isError) && (
            <span className="block h-7 w-2/3 rounded bg-muted animate-pulse" aria-label="Checking the catalogue" />
          )}
          {exactSearchReady && exact.isError && (
            <button type="button" onClick={() => exact.refetch()} className="text-[11px] font-semibold text-destructive underline underline-offset-2">
              Could not check the catalogue. Retry
            </button>
          )}
          {exactProduct && (
            <div className="flex flex-wrap items-center gap-2 rounded border border-indigo-200 bg-indigo-50/60 px-2 py-1.5 text-xs dark:border-indigo-900/40 dark:bg-indigo-950/20" data-testid={`text-exact-match-${blockId}`}>
              <span className="font-mono font-black text-primary">{exactProduct.itemCode}</span>
              <span className="min-w-0 truncate font-semibold">{exactProduct.productName ?? "Unnamed product"}</span>
              <span className="text-muted-foreground">{[exactProduct.division, exactProduct.category].filter(Boolean).join(" · ")}</span>
              <Button type="button" size="sm" className="ml-auto h-7 gap-1 text-xs" onClick={() => onChange({ itemCode: exactProduct.itemCode, adHoc: false })} data-testid={`button-use-catalogue-${blockId}`}>
                <Check className="h-3 w-3" /> Use catalogue product
              </Button>
            </div>
          )}
          {exactSettled && !exactProduct && (
            <div className="space-y-2" data-testid={`panel-adhoc-product-${blockId}`}>
              <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                <AdHocBadge /> <span className="font-mono text-foreground">{code}</span> is not in the catalogue. It can be added for this quote only, with no division or category.
              </p>
              {nearMatches.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 text-[11px]">
                  <span className="text-muted-foreground">Similar catalogue codes:</span>
                  {nearMatches.map((r) => (
                    <button key={r.itemCode} type="button" onClick={() => onChange({ itemCode: r.itemCode, adHoc: false })}
                      className="rounded border px-1.5 py-0.5 font-mono hover:bg-indigo-50 dark:hover:bg-indigo-950/40" data-testid={`button-near-${blockId}-${r.itemCode}`}>
                      {r.itemCode}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  ref={descRef}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Description (required)"
                  aria-label={`Description for ad-hoc product, block ${index + 1}`}
                  aria-required
                  data-testid={`input-adhoc-description-${blockId}`}
                  className="h-8 min-w-[200px] flex-1 text-sm"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!description.trim()}
                  onClick={() => onChange({ itemCode: code, adHoc: true, description })}
                  data-testid={`button-add-adhoc-product-${blockId}`}
                  className="h-8 border-fuchsia-300 text-xs font-semibold text-fuchsia-800 hover:bg-fuchsia-50 dark:text-fuchsia-200"
                >
                  Add as ad-hoc product
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
