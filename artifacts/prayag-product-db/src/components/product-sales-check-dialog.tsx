import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type SalesResult = {
  itemCode: string;
  status: "sold" | "never_sold" | "unknown";
  reason: string;
  catalogueStatus: string | null;
};

export function ProductSalesCheckDialog({ itemCodes, onClose }: { itemCodes: string[]; onClose: () => void }) {
  const [results, setResults] = useState<SalesResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const params = new URLSearchParams();
        itemCodes.forEach((code) => params.append("itemCode", code));
        const response = await fetch(`/api/admin/product-retirement/sales-check?${params}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? `Sales check failed (${response.status}).`);
        setResults(data.results);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Sales check failed.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [itemCodes]);

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="presentation">
    <section role="dialog" aria-modal="true" aria-labelledby="sales-gate-heading" className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg border bg-background p-5 shadow-xl">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 id="sales-gate-heading" className="text-xl font-semibold">Sales history check</h2>
          <p className="text-sm text-muted-foreground">Read-only check for {itemCodes.length} selected product{itemCodes.length === 1 ? "" : "s"}. This does not enable deletion.</p>
        </div>
        <Button variant="outline" onClick={onClose}>Close</Button>
      </header>
      {loading && <p className="text-sm">Checking Sales coverage…</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error} Deletion remains unavailable.</p>}
      <div className="space-y-2">{results.map((row) => <div key={row.itemCode} className="rounded border p-3 text-sm">
        <strong>{row.itemCode}</strong> · {row.status === "sold" ? "Sold — do not delete; use Retire" :
          row.status === "never_sold" ? "No sales found — other deletion checks still required" : "Unknown — deletion blocked"}
        <p className="text-muted-foreground">{row.reason}</p>
        {row.catalogueStatus && <p className="text-xs text-muted-foreground">Sales catalogue snapshot: {row.catalogueStatus} (context only; not deletion evidence)</p>}
      </div>)}</div>
    </section>
  </div>;
}