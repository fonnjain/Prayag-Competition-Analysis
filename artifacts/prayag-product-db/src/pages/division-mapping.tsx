import { useEffect, useRef, useState } from "react";
import type { DivisionMappingEnvelope, DivisionMappingHistory } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { DivisionCatalogueDisclosure } from "../components/division-catalogue-disclosure";

export default function DivisionMappingPage() {
  const [file, setFile] = useState<File | null>(null);
  const [date, setDate] = useState("");
  const [batch, setBatch] = useState<DivisionMappingEnvelope | null>(null);
  const [history, setHistory] = useState<DivisionMappingHistory["batches"]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const generation = useRef(0);
  const client = useQueryClient();
  const base = "/api/catalog/division-mapping";
  async function refresh() {
    const r = await fetch(base);
    if (!r.ok) throw new Error("Could not load division batch history.");
    const data = await r.json() as DivisionMappingHistory;
    setHistory(data.batches);
  }
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const r = await fetch(base);
        if (!r.ok) throw new Error("Administrator access is required.");
        const data = await r.json() as DivisionMappingHistory;
        if (active) setHistory(data.batches);
      } catch (e) { if (active) setMessage(e instanceof Error ? e.message : "Could not load history."); }
    };
    void load();
    const timer = setInterval(() => { void load(); }, 30000);
    return () => { active = false; clearInterval(timer); generation.current++; };
  }, []);
  async function run(action: "preview" | "apply" | "undo" | "open", id?: number) {
    const current = ++generation.current;
    setBusy(true); setMessage("");
    try {
      let url = id ? `${base}/${id}` : base;
      const init: RequestInit = {};
      if (action === "preview") {
        const body = new FormData(); body.append("file", file!); body.append("downloadedAt", date);
        url += "/preview"; init.method = "POST"; init.body = body;
      } else if (action !== "open") {
        url += `/${action}`; init.method = "POST"; init.headers = { "Content-Type": "application/json" }; init.body = JSON.stringify({ confirm: true });
      }
      const r = await fetch(url, init);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Operation failed.");
      if (current !== generation.current) return;
      if (action === "apply" || action === "undo") {
        const detail = await fetch(`${base}/${id}`);
        if (!detail.ok) throw new Error("The action completed, but the refreshed batch could not be loaded. Open it from history.");
        setBatch(await detail.json() as DivisionMappingEnvelope);
        await client.invalidateQueries();
        setMessage(action === "apply" ? "Division-only batch applied. Undo is available below and in batch history." : "Batch undone; later edits were not overwritten.");
      } else setBatch(data as DivisionMappingEnvelope);
      setConfirmed(false);
      await refresh();
    } catch (e) { if (current === generation.current) setMessage(e instanceof Error ? e.message : "Operation failed."); }
    finally { if (current === generation.current) setBusy(false); }
  }
  function clear() { generation.current++; setBatch(null); setConfirmed(false); setMessage(""); }
  const preview = batch?.preview;
  return <main className="mx-auto max-w-6xl space-y-6 p-6">
    <header><h1 className="text-2xl font-semibold">Division mapping</h1><p className="mt-2 text-sm text-muted-foreground">Reviewed v3 workbook · exact item codes · division only. Sink prices still use the PTMT workbook.</p></header>
    <section className="space-y-4 rounded-xl border bg-card p-5">
      <p className="text-sm">No price access or changes. No product creation, code merging, category changes or action on EXCLUDE rows. Preview stages an audit batch; only Apply changes divisions.</p>
      <label className="block text-sm">Reviewed workbook<input disabled={busy} type="file" accept=".xlsx" className="mt-2 block w-full rounded border p-2" onChange={e => { clear(); setFile(e.target.files?.[0] ?? null); }} /></label>
      <label className="block text-sm">Actual workbook download date<input disabled={busy} type="date" className="ml-3 rounded border bg-background p-2" value={date} onChange={e => { clear(); setDate(e.target.value); }} /></label>
      <button disabled={busy || !file || !date} onClick={() => void run("preview")} className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">Preview division mapping</button>
    </section>
    {message && <p role="status" className="rounded border p-4 text-sm">{message}</p>}
    {preview && <section className="space-y-4 rounded-xl border bg-card p-5">
      <h2 className="text-lg font-semibold">Batch #{batch?.loadBatchId} · {batch?.status}</h2>
      <p>Matched: {preview.matched} · Already correct: {preview.unchanged} · Changes: {preview.changes.length} · Unmapped: {preview.missing.length} · EXCLUDE: {preview.excluded.length}</p>
      <div className="overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th>From</th><th>To</th><th>Products</th></tr></thead><tbody>{preview.groups.map((g, i) => <tr key={i} className="border-t"><td className="p-2">{g.from}</td><td>{g.to}</td><td>{g.count}</td></tr>)}</tbody></table></div>
      {preview.catalogueBefore && preview.catalogueAfter
        ? <DivisionCatalogueDisclosure before={preview.catalogueBefore} after={preview.catalogueAfter} projected />
        : <div className="rounded border p-3"><p>Legacy preview: create a new preview for exact-code catalogue warnings.</p><pre className="overflow-auto text-xs">{JSON.stringify({ before: preview.before, after: preview.after }, null, 2)}</pre></div>}
      {batch?.result?.catalogueBefore && batch.result.catalogueAfter && <section className="space-y-3 rounded border p-4">
        <h3 className="font-semibold">Actual {batch.status === "undone" ? "Undo" : "Apply"} report</h3>
        <DivisionCatalogueDisclosure before={batch.result.catalogueBefore} after={batch.result.catalogueAfter} restored={batch.status === "undone"} />
      </section>}
      <details><summary>All {preview.changes.length} changes and reasons</summary><ul className="max-h-80 space-y-3 overflow-auto p-3 text-sm">{preview.changes.map(c => <li key={c.itemCode}><b>{c.itemCode}</b>: {c.from} → {c.to}<p className="text-muted-foreground">{c.basis}</p></li>)}</ul></details>
      <details><summary>{preview.missing.length} unmapped products — keep current division</summary><ul className="max-h-64 overflow-auto p-3 text-sm">{preview.missing.map(p => <li key={p.itemCode}>{p.itemCode} · {p.division}</li>)}</ul></details>
      <details><summary>{preview.excluded.length} EXCLUDE rows — no action</summary><ul className="max-h-64 space-y-2 overflow-auto p-3 text-sm">{preview.excluded.map(p => <li key={p.itemCode}><b>{p.itemCode}</b> · {p.present ? "Present" : "Absent"} · {p.action}<p>{p.basis}</p></li>)}</ul></details>
      {(batch?.status === "pending" || batch?.status === "applied") && <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={busy} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /><span>I reviewed this division-only {batch.status === "applied" ? "undo" : "apply"}. No prices, categories or codes will change.</span></label>}
      {batch?.status === "pending" && <button disabled={busy || !confirmed || !preview.changes.length} className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50" onClick={() => void run("apply", batch.id)}>Apply reviewed divisions</button>}
      {batch?.status === "applied" && <button disabled={busy || !confirmed} className="rounded border px-4 py-2 disabled:opacity-50" onClick={() => void run("undo", batch.id)}>Undo this batch</button>}
    </section>}
    <section className="rounded-xl border bg-card p-5"><h2 className="mb-3 text-lg font-semibold">Persistent batch history</h2>{!history.length && <p className="text-sm text-muted-foreground">No division mapping batches.</p>}<ul className="space-y-2">{history.map(b => <li key={b.id}><button disabled={busy} className="text-left text-sm underline disabled:opacity-50" onClick={() => void run("open", b.id)}>Batch #{b.loadBatchId} · {b.fileName} · {b.status}</button></li>)}</ul></section>
  </main>;
}
