import { useState } from "react";

export default function MrpProvenanceBackfillPage() {
  const [preview, setPreview] = useState<any>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [runId, setRunId] = useState<number | null>(null);
  const [after, setAfter] = useState<any>(null);
  async function loadPreview() {
    setBusy(true); setMessage("");
    const response = await fetch("/api/admin/mrp-provenance-backfill/preview");
    const data = await response.json(); setBusy(false);
    if (!response.ok) return setMessage(data.error ?? "Preview failed.");
    setPreview(data);
  }
  async function apply() {
    if (!preview) return;
    setBusy(true); setMessage("");
    const response = await fetch("/api/admin/mrp-provenance-backfill/apply", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ existingChecksum: preview.existingChecksum }),
    });
    const data = await response.json(); setBusy(false);
    if (!response.ok) return setMessage(data.error ?? "Apply failed.");
    setRunId(data.runId); setAfter(data.fullTableAfter); setMessage(`Applied ${data.rowCount} legacy row linkages.`);
  }
  async function undo() {
    if (!runId) return;
    setBusy(true);
    const response = await fetch(`/api/admin/mrp-provenance-backfill/undo/${runId}`, { method: "POST" });
    const data = await response.json(); setBusy(false);
    setMessage(response.ok ? `Undone; restored ${data.restoredRows} rows.` : data.error ?? "Undo failed.");
  }
  return <main className="mx-auto max-w-5xl space-y-6 p-6">
    <header><h1 className="text-2xl font-semibold">Legacy MRP provenance backfill</h1>
      <p className="text-muted-foreground">Admin-only provenance reconciliation. Prices and products are never changed.</p></header>
    <div className="flex gap-3"><button className="rounded bg-primary px-4 py-2 text-primary-foreground" disabled={busy} onClick={loadPreview}>Preview</button>
      <button className="rounded border px-4 py-2" disabled={busy || !preview || !!runId} onClick={apply}>Apply</button>
      <button className="rounded border px-4 py-2" disabled={busy || !runId} onClick={undo}>Undo last apply</button></div>
    {message && <p className="rounded border p-3">{message}</p>}
    {preview && <section className="space-y-3 rounded border p-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><div><b>{preview.rowCount}</b><small className="block">rows</small></div>
        <div><b>{preview.batchCount}</b><small className="block">retrospective batches</small></div>
        <div><b>{preview.actorCoverage.knownRows}</b><small className="block">known actor/time</small></div>
        <div><b>{preview.actorCoverage.unknownRows}</b><small className="block">creation time UNKNOWN</small></div></div>
      <p className="text-xs break-all">Existing checksum: {preview.existingChecksum}</p>
      <p className="text-xs break-all">Value-only checksum: {preview.valueOnlyChecksum}</p>
      <p className="text-xs break-all">Full table before: {preview.fullTableBefore.rowCount} rows · SHA-256 {preview.fullTableBefore.sha256}</p>
      {after && <p className="text-xs break-all">Full table after: {after.rowCount} rows · SHA-256 {after.sha256}</p>}
      <h2 className="font-medium">Exact affected rows</h2>
      <div className="max-h-96 overflow-auto text-sm">{preview.rows.map((row: any) =>
        <div className="border-b py-1" key={row.id}>#{row.id} {row.itemCode} · {row.effectiveDate} · {row.mrp ?? "null"} · {row.actor ?? "not recorded"} · {row.createdAt ?? "UNKNOWN"}</div>)}</div>
    </section>}
  </main>;
}