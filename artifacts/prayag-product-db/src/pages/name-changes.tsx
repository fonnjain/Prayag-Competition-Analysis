import { useState } from "react";

type Preview = {
  rowsRead: number;
  codesMatched: number;
  oldNameVerified: number;
  oldNameMismatched: number;
  alreadyCorrect: number;
  wouldUpdate: number;
  eligibleRows: number;
  mrpUnchangedMismatched?: Array<{ itemCode: string; expected: number; actual: number | null }>;
  priceRowsToWrite: number;
  competitorRowsToTouch: number;
  productsToCreate: number;
  mismatched: Array<{ row: number; itemCode: string; reasons: string[]; storedName: string | null }>;
};

export default function NameChangesPage() {
  const [file, setFile] = useState<File | null>(null);
  const [batchId, setBatchId] = useState<number | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  async function previewWorkbook() {
    if (!file) return;
    setBusy(true); setMessage(""); setResult(null);
    const body = new FormData(); body.append("file", file);
    const response = await fetch("/api/catalog/name-changes/preview", { method: "POST", body });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) { setMessage(data.error ?? "Preview failed."); return; }
    setBatchId(data.pendingBatchId); setPreview(data.preview);
  }

  async function applyBatch() {
    if (!batchId) return;
    setBusy(true); setMessage("");
    const response = await fetch(`/api/catalog/name-changes/${batchId}/apply`, { method: "POST" });
    const data = await response.json(); setBusy(false);
    if (!response.ok) { setMessage(data.error ?? "Apply failed."); return; }
    setResult(data.result);
    if (data.result?.loadBatchId) setBatchId(data.result.loadBatchId);
    setMessage("Name changes applied and recorded in the audit trail.");
  }

  async function undoBatch() {
    if (!batchId) return;
    setBusy(true); setMessage("");
    const response = await fetch(`/api/catalog/name-changes/${batchId}/undo`, { method: "POST" });
    const data = await response.json(); setBusy(false);
    if (!response.ok) { setMessage(data.error ?? "Undo failed."); return; }
    setResult(data.result); setMessage("The batch was undone. Historical product-name copies were not changed.");
  }

  const blocked = !preview || preview.priceRowsToWrite !== 0 || preview.competitorRowsToTouch !== 0 || preview.productsToCreate !== 0 || (preview.mrpUnchangedMismatched?.length ?? 0) > 0;
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <p className="text-sm font-medium text-primary">Controlled catalogue change · P024</p>
        <h1 className="text-2xl font-semibold">Prayag product-name updates</h1>
        <p className="mt-1 text-sm text-muted-foreground">Upload the signed workbook, review the immutable preview, then apply or undo one audited batch.</p>
      </header>
      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <label className="block text-sm font-medium">Name-change workbook</label>
        <input className="mt-2 block w-full rounded-md border p-2 text-sm" type="file" accept=".xlsx,.xls" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        <button className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50" disabled={!file || busy} onClick={previewWorkbook}>
          {busy ? "Working…" : "Preview workbook"}
        </button>
      </section>
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
          {!!preview.mrpUnchangedMismatched?.length && <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-950">
            <p className="font-semibold">Standard MRP changed — Apply is blocked</p>
            <ul className="mt-2 space-y-1">{preview.mrpUnchangedMismatched.map((row) => <li key={row.itemCode}><b>{row.itemCode}</b>: workbook {row.expected}, current {row.actual ?? "missing"}</li>)}</ul>
          </div>}
          <div className="flex flex-wrap gap-3">
            <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50" disabled={blocked || busy || !batchId} onClick={applyBatch}>Apply verified names</button>
            {result && <button className="rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50" disabled={busy} onClick={undoBatch}>Undo this batch</button>}
          </div>
        </section>
      )}
      {message && <p className="rounded-md border bg-muted/30 p-3 text-sm">{message}</p>}
      {result && <pre className="overflow-auto rounded-lg bg-muted p-4 text-xs">{JSON.stringify(result, null, 2)}</pre>}
    </main>
  );
}