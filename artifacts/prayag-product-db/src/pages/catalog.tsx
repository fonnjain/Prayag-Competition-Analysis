import { useState, useEffect } from "react";
import {
  useGetCatalogProducts,
  useGetCatalogFilters,
  usePatchCatalogProductMrp,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Download, ChevronLeft, ChevronRight, Pencil, Check, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const PAGE_SIZE = 50;

interface InlineEditState {
  itemCode: string;
  mrp: string;
  effectiveDate: string;
}

function MrpCell({
  itemCode,
  currentMrp,
  hasPrice,
  effectiveDate,
}: {
  itemCode: string;
  currentMrp: number | null;
  hasPrice: boolean;
  effectiveDate: string | null;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [mrpInput, setMrpInput] = useState("");
  const [dateInput, setDateInput] = useState(
    () => new Date().toISOString().slice(0, 10)
  );
  const [error, setError] = useState<string | null>(null);

  const { mutate, isPending } = usePatchCatalogProductMrp({
    mutation: {
      onSuccess: () => {
        // Invalidate all catalog product list queries so the new MRP shows up.
        queryClient.invalidateQueries({ queryKey: ["getCatalogProducts"] });
        setEditing(false);
        setError(null);
      },
      onError: (err: unknown) => {
        const msg =
          err && typeof err === "object" && "message" in err
            ? String((err as { message: string }).message)
            : "Save failed";
        setError(msg);
      },
    },
  });

  const startEdit = () => {
    setMrpInput(currentMrp != null ? String(currentMrp) : "");
    setDateInput(effectiveDate ?? new Date().toISOString().slice(0, 10));
    setError(null);
    setEditing(true);
  };

  const save = () => {
    const val = parseFloat(mrpInput);
    if (isNaN(val) || val <= 0) {
      setError("Enter a positive number");
      return;
    }
    mutate({ itemCode, data: { mrp: val, effectiveDate: dateInput } });
  };

  if (editing) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground text-xs">₹</span>
          <Input
            className="h-7 w-28 text-sm font-mono px-2"
            value={mrpInput}
            onChange={(e) => setMrpInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setEditing(false);
            }}
            autoFocus
          />
          <input
            type="date"
            className="h-7 border border-input rounded-md px-2 text-xs font-mono bg-background text-foreground"
            value={dateInput}
            onChange={(e) => setDateInput(e.target.value)}
          />
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-green-600 hover:text-green-700"
            onClick={save}
            disabled={isPending}
            title="Save"
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground"
            onClick={() => setEditing(false)}
            disabled={isPending}
            title="Cancel"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        {error && <p className="text-xs text-destructive pl-4">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1 group">
      {hasPrice ? (
        <span className="font-mono">₹{currentMrp?.toFixed(2)}</span>
      ) : (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
          MRP Pending
        </span>
      )}
      <button
        onClick={startEdit}
        className="opacity-0 group-hover:opacity-100 transition-opacity ml-1 p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
        title="Edit MRP"
      >
        <Pencil className="h-3 w-3" />
      </button>
    </div>
  );
}

export default function CatalogPage() {
  const [search, setSearch] = useState("");
  const [division, setDivision] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");
  const [priceStatus, setPriceStatus] = useState<string>("all");
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [search, division, category, priceStatus]);

  const { data: filters } = useGetCatalogFilters();
  const { data: productsData, isLoading } = useGetCatalogProducts({
    search: search || undefined,
    division: division !== "all" ? division : undefined,
    category: category !== "all" ? category : undefined,
    priceStatus: priceStatus !== "all" ? priceStatus : undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  const visibleCategories = Array.from(
    new Set(
      (filters?.categories ?? [])
        .filter((c) => division === "all" || c.division === division)
        .map((c) => c.category),
    ),
  ).sort();

  const total = productsData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  const exportUrl = `/api/catalog/export?type=catalog&format=xlsx`;

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Product Catalog</h1>
          <p className="text-muted-foreground mt-1">
            {productsData?.total ? `${productsData.total} items` : "Loading..."}
          </p>
        </div>
        <Button variant="outline" asChild>
          <a href={exportUrl} download>
            <Download className="w-4 h-4 mr-2" />
            Export Catalog
          </a>
        </Button>
      </div>

      <div className="flex gap-4 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by code or name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select
          value={division}
          onValueChange={(v) => {
            setDivision(v);
            setCategory("all");
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Division" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Divisions</SelectItem>
            {(filters?.divisions ?? []).map((d) => (
              <SelectItem key={d} value={d}>
                {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {visibleCategories.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={priceStatus} onValueChange={setPriceStatus}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Price Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Prices</SelectItem>
            <SelectItem value="priced">Has Price</SelectItem>
            <SelectItem value="pending">MRP Pending</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="border rounded-md bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 font-medium text-muted-foreground">Item Code</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Name</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Category</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Size</th>
                <th className="px-4 py-3 font-medium text-muted-foreground text-right">
                  Current MRP
                  <span className="ml-1 text-xs font-normal text-muted-foreground/60">(hover to edit)</span>
                </th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Effective</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    Loading catalog...
                  </td>
                </tr>
              ) : productsData?.rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    No products found.
                  </td>
                </tr>
              ) : (
                productsData?.rows.map((product) => (
                  <tr
                    key={product.id}
                    className="border-b last:border-0 hover:bg-muted/50 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/product/${product.itemCode}`}>
                        <div className="text-primary hover:underline cursor-pointer">
                          {product.itemCode}
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3">{product.productName}</td>
                    <td className="px-4 py-3 text-muted-foreground">{product.category}</td>
                    <td className="px-4 py-3 text-muted-foreground">{product.size}</td>
                    <td className="px-4 py-2">
                      <MrpCell
                        itemCode={product.itemCode}
                        currentMrp={product.currentMrp ?? null}
                        hasPrice={product.hasPrice}
                        effectiveDate={product.effectiveDate ?? null}
                      />
                    </td>
                    <td className="px-4 py-3 font-mono text-muted-foreground">
                      {product.effectiveDate || "-"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between mt-4">
        <p className="text-sm text-muted-foreground font-mono">
          {total === 0 ? "0 results" : `${rangeStart}–${rangeEnd} of ${total}`}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || isLoading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground font-mono px-2">
            Page {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages || isLoading}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
}
