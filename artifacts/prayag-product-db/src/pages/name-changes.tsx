import { useRef, useState } from "react";
import { formatMoney } from "@workspace/formatting";
import type {
  CatalogNameChangeApplyResponse,
  CatalogNameChangeConflictResponse,
  CatalogNameChangePreview,
  CatalogNameChangeProduct,
  CatalogNameChangeProductsResponse,
  CatalogNameChangeSinglePreviewResponse,
  CatalogNameChangeUndoResponse,
} from "@workspace/api-client-react";

type NameChangeResult =
  | CatalogNameChangeApplyResponse["result"]
  | CatalogNameChangeUndoResponse["result"]
  | { noop: true; message?: string };

export default function NameChangesPage() {
  const [file, setFile] = useState<File | null>(null);
  const [batchId, setBatchId] = useState<number | null>(null);
  const [preview, setPreview] = useState<CatalogNameChangePreview | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<NameChangeResult | null>(null);
  const [mode, setMode] = useState<"bulk" | "single">("bulk");
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<CatalogNameChangeProduct[]>([]);
  const [selected, setSelected] = useState<CatalogNameChangeProduct | null>(null);
  const [singleName, setSingleName] = useState("");
  const [reason, setReason] = useState("");
  const requestGeneration = useRef(0);
  const clearPending = () => {
    requestGeneration.current += 1;
    setPreview(null); setBatchId(null); setResult(null); setMessage("");
  };

  async function previewWorkbook() {
    if (!file) return;
    const generation = ++requestGeneration.current;
    setBusy(true); setMessage(""); setResult(null);
    const body = new FormData(); body.append("file", file);
    const response = await fetch("/api/catalog/name-changes/preview", { method: "POST", body });
    const data = await response.json();
    if (generation !== requestGeneration.current) { setBusy(false); return; }
    setBusy(false);
    if (!response.ok) { setMessage(data.error ?? "Preview failed."); return; }
    setBatchId(data.pendingBatchId); setPreview(data.preview);
  }

  async function applyBatch() {
    if (!batchId) return;
    const generation = ++requestGeneration.current;
    setBusy(true); setMessage("");
    const response = await fetch(`/api/catalog/name-changes/${batchId}/apply`, { method: "POST" });
    const data = await response.json() as CatalogNameChangeApplyResponse | CatalogNameChangeConflictResponse;
    if (generation !== requestGeneration.current) { setBusy(false); return; }
    setBusy(false);
    if (!response.ok) {
      const conflict = data as CatalogNameChangeConflictResponse;
      setMessage(conflict.submittedOldName !== undefined
        ? `${conflict.error ?? "Concurrency conflict"} Submitted old name: "${conflict.submittedOldName}". Current live name: "${conflict.currentName}".`
        : conflict.error ?? "Apply failed.");
      return;
    }
    const applied = data as CatalogNameChangeApplyResponse;
    setResult(applied.result);
    if (applied.result.loadBatchId) setBatchId(applied.result.loadBatchId);
    setMessage("Name changes applied and recorded in the audit trail.");
  }

  async function previewSingle() {
    if (!selected) return;
    const generation = ++requestGeneration.current;
    const intent = `${mode}\u001f${selected.itemCode}\u001f${selected.productName ?? ""}\u001f${singleName}\u001f${reason}`;
    setBusy(true); setMessage("");
    const response = await fetch("/api/catalog/name-changes/single/preview", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemCode: selected.itemCode, oldName: selected.productName, newName: singleName, reason }) });
    const data = await response.json() as CatalogNameChangeSinglePreviewResponse & CatalogNameChangeConflictResponse;
    const currentIntent = `${mode}\u001f${selected?.itemCode ?? ""}\u001f${selected?.productName ?? ""}\u001f${singleName}\u001f${reason}`;
    if (generation !== requestGeneration.current || intent !== currentIntent) { setBusy(false); return; }
    setBusy(false);
    if (!response.ok) {
      setMessage(data.error ?? "Preview failed.");
      if (data.submittedOldName || data.currentName) setMessage(`${data.error ?? "Concurrency conflict"} Submitted old name: "${data.submittedOldName}". Current live name: "${data.currentName}".`);
      return;
    }
    setBatchId(data.pendingBatchId ?? null); setPreview(data.preview); setResult(data.noop ? { noop: true, message: data.message } : null);
  }

  async function undoBatch() {
    if (!batchId) return;
    const generation = ++requestGeneration.current;
    setBusy(true); setMessage("");
    const response = await fetch(`/api/catalog/name-changes/${batchId}/undo`, { method: "POST" });
    const data = await response.json() as CatalogNameChangeUndoResponse & CatalogNameChangeConflictResponse;
    if (generation !== requestGeneration.current) { setBusy(false); return; }
    setBusy(false);
    if (!response.ok) { setMessage(data.error ?? "Undo failed."); return; }
    setResult(data.result); setMessage("The batch was undone. Historical product-name copies were not changed.");
  }

  const blocked = !preview || preview.priceRowsToWrite !== 0 || preview.competitorRowsToTouch !== 0 || preview.productsToCreate !== 0 || !batchId;
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <p className="text-sm font-medium text-primary">Controlled catalogue change · P026r2</p>
        <h1 className="text-2xl font-semibold">Prayag product-name updates</h1>
        <p className="mt-1 text-sm text-muted-foreground">Names only. Prices are read-only and never submitted.</p>
      </header>
      <div className="flex gap-2"><button disabled={busy} className="rounded-md border px-3 py-2 text-sm disabled:opacity-50" onClick={() => { clearPending(); setMode("bulk"); }}>Upload a workbook</button><button disabled={busy} className="rounded-md border px-3 py-2 text-sm disabled:opacity-50" onClick={() => { clearPending(); setMode("single"); }}>Edit one name</button></div>
      {mode === "single" ? <section className="space-y-3 rounded-xl border bg-card p-5 shadow-sm">
        <input disabled={busy} className="w-full rounded-md border p-2 text-sm disabled:opacity-50" placeholder="Search Cat No. or name" value={query} onChange={async (e) => { clearPending(); const generation = requestGeneration.current; const value = e.target.value; setQuery(value); const r = await fetch(`/api/catalog/name-changes/products?q=${encodeURIComponent(value)}`); const data = await r.json() as CatalogNameChangeProductsResponse; if (generation === requestGeneration.current) setProducts(data.products); }} />
        <div className="space-y-1">{products.map((p) => <button disabled={busy} key={p.itemCode} className="block w-full rounded border p-2 text-left text-sm disabled:opacity-50" onClick={() => { clearPending(); setSelected(p); setSingleName(""); setReason(""); }}>{p.itemCode} · {p.productName}</button>)}</div>
        {selected && <div className="space-y-3 text-sm"><p><b>{selected.itemCode}</b> · {selected.productName} · {selected.division} / {selected.series} · {selected.size ?? "—"} · MRP {formatMoney(selected.currentMrp)} {selected.discontinued ? " · DISCONTINUED" : ""}</p>
          <input disabled={busy} maxLength={500} className="w-full rounded-md border p-2 disabled:opacity-50" placeholder="New name" value={singleName} onChange={(e) => { clearPending(); setSingleName(e.target.value); }} /><input disabled={busy} maxLength={500} className="w-full rounded-md border p-2 disabled:opacity-50" placeholder="Required reason" value={reason} onChange={(e) => { clearPending(); setReason(e.target.value); }} />
          <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50" disabled={busy || !singleName || !reason} onClick={previewSingle}>Preview name edit</button></div>}
      </section> :
      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <label className="block text-sm font-medium">Name-change workbook</label>
        <input disabled={busy} className="mt-2 block w-full rounded-md border p-2 text-sm disabled:opacity-50" type="file" accept=".xlsx,.xls" onChange={(event) => { clearPending(); setFile(event.target.files?.[0] ?? null); }} />
        <button className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50" disabled={!file || busy} onClick={previewWorkbook}>
          {busy ? "Working…" : "Preview workbook"}
        </button>
      </section>}
      {preview && (
        <section className="space-y-4 rounded-xl border bg-card p-5 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["Rows read", preview.rowsRead], ["Codes matched", preview.codesMatched],
              ["Eligible rows", preview.eligibleRows], ["Old name verified", preview.oldNameVerified], ["Mismatched", preview.oldNameMismatched],
              ["Already correct", preview.alreadyCorrect], ["Would update", preview.wouldUpdate],
            ].map(([label, value]) => <div key={label} className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-semibold">{value}</p></div>)}
          </div>
          <div className="rounded-lg border p-4 text-sm">
            <p className="font-semibold">Safety gate</p>
            <p className="mt-1">Price rows to write: <b>0</b> · Competitor rows to touch: <b>0</b> · Products to create: <b>0</b></p>
          </div>
          {preview.mismatched.length > 0 && <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-semibold">Rows skipped and listed in full</p>
            <ul className="mt-2 max-h-64 space-y-1 overflow-auto">{preview.mismatched.map((row) => <li key={`${row.row}-${row.itemCode}`}>Row {row.row} · <b>{row.itemCode}</b> — {row.reasons.join(", ")}{row.storedName ? ` (stored: ${row.storedName})` : ""}</li>)}</ul>
          </div>}
          {preview.duplicateNameCount !== undefined && <p className="text-sm text-amber-700">Other products sharing this name: {preview.duplicateNameCount}. This is a warning only.</p>}
          {preview.trimmed && <p className="text-sm text-blue-700">Leading/trailing whitespace was trimmed; internal characters were unchanged.</p>}
          {result && "noop" in result && result.noop && <p className="text-sm font-semibold text-muted-foreground">{result.message ?? "No-op: nothing was written."}</p>}
          <div className="flex flex-wrap gap-3">
            <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50" disabled={blocked || busy || !batchId} onClick={applyBatch}>Apply verified names</button>
            {result && !("noop" in result) && <button className="rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50" disabled={busy} onClick={undoBatch}>Undo this batch</button>}
          </div>
        </section>
      )}
      {message && <p className="rounded-md border bg-muted/30 p-3 text-sm">{message}</p>}
      {result && <pre className="overflow-auto rounded-lg bg-muted p-4 text-xs">{JSON.stringify(result, null, 2)}</pre>}
    </main>
  );
}