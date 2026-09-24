import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type PreviewRow = {
  itemCode: string;
  productName?: string | null;
  allowed: boolean;
  reason?: string | null;
  priceRowCount?: number;
  priceDates?: string[];
  fingerprint?: string;
};
type Preview = {
  results: PreviewRow[];
  historyBefore: number;
  historyAfter: number;
  undoHours: number;
};
type ApplyRow = { itemCode: string; applied: boolean; reason?: string; batchId?: number; priceRowCount?: number };

async function post<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status}).`);
  return result as T;
}

type RecentRow = {
  batchId: number; itemCode: string; actor: string; reason: string | null;
  createdAt: string; undoneAt: string | null; undoExpiresAt: string;
  discontinuedFrom: string; canUndo: boolean; priceRowCount: number;
};

export function ProductRetirementHistory({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<RecentRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/product-retirement/recent");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load retirement history.");
      setRows(data.results);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load retirement history.");
    } finally { setBusy(false); }
  }
  // The history is loaded when the dialog opens; no action depends on a prior
  // page's in-memory batch ID.
  useEffect(() => { void load(); }, []);
  async function undo(id: number) {
    setBusy(true); setError("");
    try {
      await post(`/admin/product-retirement/undo/${id}`);
      await queryClient.invalidateQueries({ queryKey: ["getCatalogProducts"] });
      await queryClient.invalidateQueries({ queryKey: ["getCatalogFilters"] });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Undo failed.");
    } finally { setBusy(false); }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="presentation">
    <section role="dialog" aria-modal="true" aria-labelledby="retirement-history-heading" className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg border bg-background p-5 shadow-xl">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div><h2 id="retirement-history-heading" className="text-xl font-semibold">Recent retirements</h2>
          <p className="text-sm text-muted-foreground">Undo is available for 24 hours, unless the product has changed since retirement.</p></div>
        <Button type="button" variant="outline" onClick={onClose}>Close</Button>
      </header>
      {busy && <p className="text-sm">Loading…</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!busy && !rows.length && !error && <p className="text-sm text-muted-foreground">No retirements recorded.</p>}
      <div className="space-y-2">{rows.map((row) => <div key={row.batchId} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm">
        <div>
          <strong>{row.itemCode}</strong> · retired from {row.discontinuedFrom} · {row.priceRowCount} price rows kept
          <p className="text-xs text-muted-foreground">{row.actor} · {new Date(row.createdAt).toLocaleString()} · {row.reason}</p>
          <p className="text-xs text-muted-foreground">{row.undoneAt ? "Undone" : row.canUndo ? `Undo before ${new Date(row.undoExpiresAt).toLocaleString()}` : "Undo window expired"}</p>
        </div>
        {row.canUndo && <Button variant="outline" size="sm" disabled={busy} onClick={() => undo(row.batchId)}>Undo</Button>}
      </div>)}</div>
    </section>
  </div>;
}

export function ProductRetirementDialog({ itemCodes, onClose }: { itemCodes: string[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [results, setResults] = useState<ApplyRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function loadPreview() {
    setBusy(true); setError(""); setPreview(null); setResults(null);
    try {
      setPreview(await post<Preview>("/admin/product-retirement/preview", { itemCodes, discontinuedFrom: date }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Preview failed.");
    } finally { setBusy(false); }
  }

  async function apply() {
    if (!preview) return;
    setBusy(true); setError("");
    try {
      const result = await post<{ results: ApplyRow[] }>("/admin/product-retirement/apply", {
        discontinuedFrom: date, reason,
        items: preview.results.filter((row) => row.allowed).map((row) => ({
          itemCode: row.itemCode, fingerprint: row.fingerprint,
        })),
      });
      setResults(result.results);
      setPreview(null);
      if (result.results.some((row) => row.applied)) {
        await queryClient.invalidateQueries({ queryKey: ["getCatalogProducts"] });
        await queryClient.invalidateQueries({ queryKey: ["getCatalogFilters"] });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Retirement failed.");
      setPreview(null);
    } finally { setBusy(false); }
  }

  async function undo(batchId: number) {
    setBusy(true); setError("");
    try {
      await post(`/admin/product-retirement/undo/${batchId}`);
      setResults((current) => current?.map((row) => row.batchId === batchId ? { ...row, applied: false, reason: "Retirement undone.", batchId: undefined } : row) ?? null);
      await queryClient.invalidateQueries({ queryKey: ["getCatalogProducts"] });
      await queryClient.invalidateQueries({ queryKey: ["getCatalogFilters"] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Undo failed.");
    } finally { setBusy(false); }
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="presentation">
    <section role="dialog" aria-modal="true" aria-labelledby="retire-heading" className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg border bg-background p-5 shadow-xl">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 id="retire-heading" className="text-xl font-semibold">Retire {itemCodes.length} product{itemCodes.length === 1 ? "" : "s"}</h2>
          <p className="text-sm text-muted-foreground">Keep the product and every price row. Remove it from current views on the date you choose; past dates remain available.</p>
        </div>
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Close</Button>
      </header>
      <label className="mb-3 block text-sm font-medium">Discontinued from (required; no default)
        <Input type="date" className="mt-1" value={date} onChange={(event) => { setDate(event.target.value); setPreview(null); }} disabled={busy || !!results} />
      </label>
      <label className="mb-3 block text-sm font-medium">Reason for retirement
        <Input className="mt-1" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} placeholder="Describe why this product is discontinued" disabled={busy || !!results} />
      </label>
      {!results && <Button type="button" variant="outline" disabled={!date || busy} onClick={loadPreview}>Preview retirement</Button>}
      {error && <p role="alert" className="mt-3 rounded border border-destructive p-2 text-sm text-destructive">{error}</p>}
      {preview && <div className="mt-4 space-y-3">
        <p className="text-sm font-semibold">MRP history: {preview.historyBefore.toLocaleString()} before → {preview.historyAfter.toLocaleString()} after (no price rows removed)</p>
        <div className="max-h-64 overflow-auto rounded border">
          {preview.results.map((row) => <div key={row.itemCode} className="border-b p-3 text-sm last:border-0">
            <div className="font-medium">{row.itemCode} · {row.productName || "Unnamed product"} — {row.allowed ? "Ready to retire" : "Blocked"}</div>
            <div>{row.priceRowCount ?? 0} price rows preserved{row.priceDates?.length ? ` (${row.priceDates.join(", ")})` : ""}</div>
            {row.reason && <p className="text-destructive">{row.reason}</p>}
          </div>)}
        </div>
        <p className="text-xs text-muted-foreground">Apply handles each item separately and reports any that changed or became blocked. Undo is available for 24 hours if the product has not changed.</p>
        <Button type="button" disabled={busy || !reason.trim() || !preview.results.some((row) => row.allowed)} onClick={apply}>Apply retirement to ready products</Button>
      </div>}
      {results && <div className="mt-4 space-y-2" aria-live="polite">
        {results.map((row) => <div key={row.itemCode} className="flex items-center justify-between gap-2 rounded border p-2 text-sm">
          <span>{row.itemCode}: {row.applied ? `Retired; ${row.priceRowCount} price rows kept` : row.reason ?? "Not retired"}</span>
          {row.applied && row.batchId && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => undo(row.batchId!)}>Undo</Button>}
        </div>)}
      </div>}
      <p className="mt-5 border-t pt-3 text-sm text-muted-foreground"><strong>Delete is unavailable.</strong> Sales cannot yet prove complete all-time coverage; a missing sales row is not proof that a product never sold.</p>
    </section>
  </div>;
}