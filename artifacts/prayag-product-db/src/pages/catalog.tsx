import { useState, useEffect } from "react";
import { useGetCatalogProducts, useGetCatalogFilters } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Download, ChevronLeft, ChevronRight } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const PAGE_SIZE = 50;

export default function CatalogPage() {
  const [search, setSearch] = useState("");
  const [division, setDivision] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");
  const [priceStatus, setPriceStatus] = useState<string>("all");
  const [page, setPage] = useState(1);

  // Reset to the first page whenever a filter changes.
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
    pageSize: PAGE_SIZE
  });

  // Categories belonging to the selected division (or all when none selected),
  // deduped by name since the same category can appear under multiple divisions.
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
              <SelectItem key={d} value={d}>{d}</SelectItem>
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
              <SelectItem key={c} value={c}>{c}</SelectItem>
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
                <th className="px-4 py-3 font-medium text-muted-foreground text-right">Current MRP</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Effective</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loading catalog...</td>
                </tr>
              ) : productsData?.rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No products found.</td>
                </tr>
              ) : (
                productsData?.rows.map((product) => (
                  <tr key={product.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/product/${product.itemCode}`}>
                        <div className="text-primary hover:underline cursor-pointer">{product.itemCode}</div>
                      </Link>
                    </td>
                    <td className="px-4 py-3">{product.productName}</td>
                    <td className="px-4 py-3 text-muted-foreground">{product.category}</td>
                    <td className="px-4 py-3 text-muted-foreground">{product.size}</td>
                    <td className="px-4 py-3 text-right">
                      {product.hasPrice ? (
                        <span className="font-mono">₹{product.currentMrp?.toFixed(2)}</span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                          MRP Pending
                        </span>
                      )}
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
