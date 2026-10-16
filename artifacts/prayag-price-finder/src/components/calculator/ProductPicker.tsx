import { useEffect, useRef, useState } from "react";
import { Search, FolderTree } from "lucide-react";
import { useGetPriceFinderBrowse, useGetPriceFinderSearch } from "@workspace/api-client-react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { cn } from "@/lib/utils";

type Mode = "direct" | "browse";

export type ProductPickerProps = {
  blockId: string;
  index: number;
  asOf: string;
  itemCode: string | null;
  selectedLabel?: string;
  onChange: (itemCode: string | null) => void;
  scopeKey: readonly unknown[];
  scopeReady: boolean;
};

const productLabel = (code: string, name: string | null) => `${code} · ${name ?? "Unnamed product"}`;

/**
 * Two routes into the same block product: direct search (default) or
 * division -> category -> product. Switching route never clears the product.
 * Item codes are passed through verbatim.
 */
export function ProductPicker({ blockId, index, asOf, itemCode, selectedLabel, onChange, scopeKey, scopeReady }: ProductPickerProps) {
  const [mode, setMode] = useState<Mode>("direct");
  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [division, setDivision] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const onSearchChange = (next: string) => {
    setRawQuery(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setQuery(next.trim()), 180);
  };

  const searchParams = { q: query, limit: 60, asOf: asOf || undefined };
  const search = useGetPriceFinderSearch(searchParams, {
    query: {
      queryKey: ["calculator-search", query, asOf, ...scopeKey],
      enabled: scopeReady && mode === "direct" && query.length > 0,
      staleTime: 30_000,
    },
  });

  const divisionsParams = { limit: 300, asOf: asOf || undefined };
  const divisions = useGetPriceFinderBrowse(divisionsParams, {
    query: { queryKey: ["calculator-browse-divisions", asOf, ...scopeKey], enabled: scopeReady && mode === "browse", staleTime: 60_000 },
  });
  const categoriesParams = { division: division ?? undefined, limit: 300, asOf: asOf || undefined };
  const categories = useGetPriceFinderBrowse(categoriesParams, {
    query: {
      queryKey: ["calculator-browse-categories", division, asOf, ...scopeKey],
      enabled: scopeReady && mode === "browse" && !!division,
      staleTime: 60_000,
    },
  });
  const productsParams = { division: division ?? undefined, category: category ?? undefined, limit: 300, asOf: asOf || undefined };
  const products = useGetPriceFinderBrowse(productsParams, {
    query: {
      queryKey: ["calculator-browse-products", division, category, asOf, ...scopeKey],
      enabled: scopeReady && mode === "browse" && !!division && !!category,
      staleTime: 60_000,
    },
  });

  const searchOptions = (search.data?.results ?? []).map((r) => ({
    value: r.itemCode,
    label: productLabel(r.itemCode, r.productName),
    hint: [r.division, r.category].filter(Boolean).join(" · ") || undefined,
  }));

  return (
    <div className="min-w-0 space-y-2">
      <div role="tablist" aria-label={`Product selection method for block ${index + 1}`} className="inline-flex rounded-md border bg-muted/40 p-0.5 text-xs print:hidden">
        {(["direct", "browse"] as const).map((m) => (
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
            {m === "direct" ? <Search className="h-3 w-3" /> : <FolderTree className="h-3 w-3" />}
            {m === "direct" ? "Search" : "Division / category"}
          </button>
        ))}
      </div>

      {mode === "direct" ? (
        <SearchableSelect
          triggerId={`calc-product-${blockId}`}
          aria-label={`Product for block ${index + 1}`}
          data-testid={`select-product-${blockId}`}
          widthClass="w-full"
          placeholder="Search item code or product name…"
          searchPlaceholder="Type an item code or name…"
          emptyText={query ? (search.isError ? "Search failed. Try again." : "No products match") : "Start typing to search"}
          serverFiltered
          loading={!!rawQuery.trim() && (search.isFetching || rawQuery.trim() !== query)}
          onSearchChange={onSearchChange}
          value={itemCode}
          selectedLabel={selectedLabel ?? itemCode ?? undefined}
          options={searchOptions}
          onChange={(next) => next != null && onChange(next)}
        />
      ) : (
        <div className="grid gap-2 sm:grid-cols-3">
          <SearchableSelect
            aria-label={`Division for block ${index + 1}`}
            data-testid={`select-division-${blockId}`}
            widthClass="w-full"
            placeholder={divisions.isLoading ? "Loading…" : "Division"}
            searchPlaceholder="Search divisions…"
            emptyText="No division matches"
            disabled={divisions.isLoading}
            value={division}
            options={(divisions.data?.divisions ?? []).map((d) => ({ value: d.division, label: d.division, count: d.count }))}
            onChange={(next) => { setDivision(next); setCategory(null); onChange(null); }}
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
            options={(categories.data?.categories ?? []).map((c) => ({ value: c.category ?? "__uncategorised__", label: c.label, count: c.count }))}
            onChange={(next) => { setCategory(next); onChange(null); }}
          />
          <SearchableSelect
            triggerId={`calc-product-${blockId}`}
            aria-label={`Product for block ${index + 1}`}
            data-testid={`select-browse-product-${blockId}`}
            widthClass="w-full"
            placeholder={!category ? "Pick a category first" : products.isLoading ? "Loading…" : "Product"}
            searchPlaceholder="Search item code or name…"
            emptyText="No products in this category"
            disabled={!category || products.isLoading}
            value={itemCode}
            selectedLabel={selectedLabel ?? itemCode ?? undefined}
            options={(products.data?.products ?? []).map((p) => ({ value: p.itemCode, label: productLabel(p.itemCode, p.productName) }))}
            onChange={(next) => next != null && onChange(next)}
          />
        </div>
      )}
    </div>
  );
}
