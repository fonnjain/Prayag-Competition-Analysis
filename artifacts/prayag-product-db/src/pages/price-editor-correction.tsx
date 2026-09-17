import { useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetPriceEditorProductQueryKey, getGetPriceFinderSearchQueryKey,
  useGetPriceEditorProduct, useGetPriceFinderBrowse, useGetPriceFinderSearch,
  usePreviewPriceEditorChange, useSavePriceEditorChange, useUndoPriceEditorChange,
} from "@workspace/api-client-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { productDetailHref } from "@/lib/product-links";
import { AlertTriangle, CheckCircle2, Search, Undo2 } from "lucide-react";
import { useEditorInvalidate } from "./price-editor";

const today = () => new Date().toISOString().slice(0, 10);
const money = (n: number | null | undefined) => n == null ? "—" : `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (s?: string | null) => s ? new Date(`${s}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const errorText = (e: unknown) => e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "The request failed. Try again.";

type Snapshot = {
  itemCode: string; series: string; value: number; effectiveDate: string; remarks: string;
  productName: string | null;
};

export function PriceCorrectionTab() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [division, setDivision] = useState("");
  const [category, setCategory] = useState("");
  const [itemCode, setItemCode] = useState("");
  const [series, setSeries] = useState("Prayag MRP");
  const [value, setValue] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(today());
  const [remarks, setRemarks] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const formVersion = useRef(0);
  const browse = useGetPriceFinderBrowse({ division: division || undefined, category: category || undefined, limit: 300 });
  const searchParams = { q: search || undefined, limit: 50 };
  const productParams = { itemCode };
  const searchResults = useGetPriceFinderSearch(searchParams, { query: { enabled: search.length > 1, queryKey: getGetPriceFinderSearchQueryKey(searchParams) } });
  const product = useGetPriceEditorProduct(productParams, { query: { enabled: !!itemCode, queryKey: getGetPriceEditorProductQueryKey(productParams) } });
  const preview = usePreviewPriceEditorChange();
  const save = useSavePriceEditorChange();
  const undo = useUndoPriceEditorChange();
  const data = product.data;
  const selected = data?.series.find(s => s.series === series);
  const current = selected?.current;
  const old = current?.mrp ?? current?.price ?? null;
  const numeric = Number(value);
  const delta = old != null && Number.isFinite(numeric) ? numeric - old : null;
  const pct = old != null && old !== 0 && delta != null ? delta / old * 100 : null;
  const products = search.length > 1 ? searchResults.data?.results ?? [] : browse.data?.products ?? [];
  const categories = useMemo(() => browse.data?.categories ?? [], [browse.data]);
  const canPreview = !!itemCode && !!series && numeric > 0 && !!effectiveDate && !!remarks.trim();
  const invalidate = useEditorInvalidate();
  const change = () => {
    formVersion.current += 1;
    setSnapshot(null);
    setSaved(null);
    setFormError(null);
    preview.reset();
  };
  const runPreview = () => {
    if (!canPreview) return;
    const request: Snapshot = { itemCode, series, value: numeric, effectiveDate, remarks: remarks.trim(), productName: data?.product.productName ?? null };
    const requestVersion = formVersion.current;
    setFormError(null);
    preview.mutate({ data: request }, {
      onSuccess: () => {
        if (formVersion.current === requestVersion) setSnapshot(request);
      },
      onError: e => { setSnapshot(null); setFormError(errorText(e)); },
    });
  };
  const saveChange = () => {
    if (!snapshot || !preview.data) return;
    setFormError(null);
    save.mutate({ data: snapshot }, {
      onSuccess: result => {
        setSaved(`Saved ${snapshot.series} for ${snapshot.itemCode}, effective ${date(result.audit.effectiveDate)}.`);
        setSnapshot(null);
        invalidate();
      },
      onError: e => setFormError(errorText(e)),
    });
  };
  const undoEdit = (id: number) => {
    if (!window.confirm("Undo this edit? The previous value will be restored and a separate reversal audit entry will be recorded.")) return;
    setFormError(null);
    undo.mutate({ auditId: id }, { onSuccess: invalidate, onError: e => setFormError(errorText(e)) });
  };
  const reversedIds = new Set((data?.recentEdits ?? []).filter(e => e.operationType === "reversal" && e.originalAuditId != null).map(e => e.originalAuditId));

  return <div className="space-y-6">
    {saved && <Alert className="border-emerald-500/40 bg-emerald-50"><CheckCircle2 className="h-4 w-4 text-emerald-700" /><AlertTitle>Change saved</AlertTitle><AlertDescription>{saved} <Link className="font-medium underline" href={productDetailHref(itemCode)}>Open product</Link></AlertDescription></Alert>}
    {formError && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Could not complete request</AlertTitle><AlertDescription>{formError}</AlertDescription></Alert>}
    <section className="rounded-xl border bg-card p-5 shadow-sm"><h2 className="font-semibold">1. Find the product</h2><div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem_14rem]">
      <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input disabled={save.isPending} aria-label="Search products by code or name" className="pl-9" placeholder="Search code or product name…" value={search} onChange={e => { setSearch(e.target.value); setItemCode(""); change(); }} /></div>
      <select disabled={save.isPending} aria-label="Browse division" className="h-10 rounded-md border bg-background px-3 text-sm" value={division} onChange={e => { setDivision(e.target.value); setCategory(""); change(); }}><option value="">All divisions</option>{(browse.data?.divisions ?? []).map(d => <option key={d.division} value={d.division}>{d.division} ({d.count})</option>)}</select>
      <select disabled={save.isPending} aria-label="Browse category" className="h-10 rounded-md border bg-background px-3 text-sm" value={category} onChange={e => { setCategory(e.target.value); change(); }}><option value="">All categories</option>{categories.map(c => <option key={c.label} value={c.category ?? "__uncategorised__"}>{c.label} ({c.count})</option>)}</select>
    </div><div className="mt-3 max-h-52 overflow-auto rounded-lg border">{products.length ? products.map(p => <button disabled={save.isPending} type="button" key={p.itemCode} onClick={() => { setItemCode(p.itemCode); setSearch(p.itemCode); change(); }} className={`flex w-full items-start justify-between border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-muted ${itemCode === p.itemCode ? "bg-[#e8f4f2]" : ""}`}><span><b>{p.itemCode}</b> <span className="text-muted-foreground">{p.productName}</span><span className="block text-xs text-muted-foreground">{p.division} · {p.category}</span></span><span className="font-mono">{money(p.currentMrp)}</span></button>) : <p className="p-4 text-sm text-muted-foreground">{search.length > 1 ? "No catalogue product found. Products cannot be created here; use the proper catalogue route to add one." : "Choose a division and category, or search by code/name."}</p>}</div></section>
    {itemCode && <section className="rounded-xl border bg-card p-5 shadow-sm">{product.isLoading ? <p>Loading product prices…</p> : product.isError ? <Alert variant="destructive"><AlertTitle>Product prices could not load</AlertTitle><AlertDescription>Check the code and try again.</AlertDescription></Alert> : data && <>
      <h2 className="font-semibold">2. Choose the price and enter the correction</h2><p className="mt-1 text-sm text-muted-foreground">{data.product.itemCode} · {data.product.productName}</p>
      <div className="mt-4 grid gap-5 lg:grid-cols-2"><div className="space-y-4">
        <label className="block text-sm font-medium">Price series<select disabled={save.isPending} aria-label="Price series" className="mt-1 h-10 w-full rounded-md border bg-background px-3" value={series} onChange={e => { setSeries(e.target.value); setValue(""); change(); }}>{data.series.map(s => <option key={s.series}>{s.series}</option>)}</select></label>
        <div className="rounded-lg bg-muted/50 p-3 text-sm"><p className="text-muted-foreground">Current / effective</p><p className="text-xl font-semibold">{money(old)} <span className="text-sm font-normal text-muted-foreground">from {date(current?.effectiveDate)}</span></p>{selected?.previous && <p className="mt-2 text-muted-foreground">Replaced {money(selected.previous.mrp ?? selected.previous.price)} from {date(selected.previous.effectiveDate)}</p>}{old == null && series !== "Prayag MRP" && <p className="mt-2 text-amber-800">No price exists yet. Saving creates the first mapping for this product; the competitor series itself is already configured.</p>}</div>
        <label className="block text-sm font-medium">New value<input disabled={save.isPending} aria-label="New price value" type="number" min="0.01" step="0.01" className="mt-1 h-10 w-full rounded-md border bg-background px-3" value={value} onChange={e => { setValue(e.target.value); change(); }} /></label>
        <p className="text-sm">Difference: <b>{delta == null ? "First price" : `${delta >= 0 ? "+" : ""}${money(delta)}${pct == null ? "" : ` (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)`}`}</b></p>
      </div><div className="space-y-4">
        <label className="block text-sm font-medium">Remarks <span className="text-destructive">*</span><Textarea disabled={save.isPending} aria-label="Required remarks" className="mt-1" rows={4} value={remarks} onChange={e => { setRemarks(e.target.value); change(); }} placeholder="Why is this correction needed?" /></label>
        <label className="block text-sm font-medium">Effective date<input disabled={save.isPending} aria-label="Effective date" type="date" className="mt-1 h-10 w-full rounded-md border bg-background px-3" value={effectiveDate} onChange={e => { setEffectiveDate(e.target.value); change(); }} /></label>
      </div></div>
      <div className="mt-5 flex justify-end"><Button disabled={!canPreview || preview.isPending} onClick={runPreview}>{preview.isPending ? "Checking…" : "Review and confirm"}</Button></div>
      {preview.isError && <p className="mt-3 text-sm text-destructive">{errorText(preview.error)}</p>}
      {preview.data && <div className="mt-4 space-y-3 rounded-lg border p-4"><h3 className="font-semibold">API preview</h3><p className="text-sm">{preview.data.dateMeaning.wording}</p>{preview.data.warnings.map(w => <Alert key={w} className="border-amber-500 bg-amber-50"><AlertTriangle className="h-4 w-4" /><AlertDescription>{w}</AlertDescription></Alert>)}</div>}
      {snapshot && preview.data && <Confirm snapshot={snapshot} preview={preview.data} onBack={() => setSnapshot(null)} onSave={saveChange} saving={save.isPending} />}
    </>}</section>}
    {data?.recentEdits?.length ? <section className="rounded-xl border bg-card p-5 shadow-sm"><h2 className="font-semibold">Recent edits</h2><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="p-2">Actor / time</th><th className="p-2">Series / operation</th><th className="p-2">Old → new</th><th className="p-2">Effective</th><th className="p-2">Remarks</th><th /></tr></thead><tbody>{data.recentEdits.map(e => <tr key={e.id} className="border-b last:border-0"><td className="p-2">{e.actor}<br /><span className="text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</span></td><td className="p-2">{e.series}<br /><span className="text-xs">{e.operationType}</span></td><td className="p-2 font-mono">{money(e.oldValue)} → {money(e.newValue)}</td><td className="p-2">{date(e.effectiveDate)}</td><td className="max-w-xs p-2">{e.remarks}</td><td className="p-2">{e.operationType === "save" && !reversedIds.has(e.id) && <Button size="sm" variant="outline" onClick={() => undoEdit(e.id)} disabled={undo.isPending}><Undo2 className="mr-1 h-3 w-3" />Undo</Button>}</td></tr>)}</tbody></table></div></section> : null}
  </div>;
}

function Confirm({ snapshot, preview, onBack, onSave, saving }: { snapshot: Snapshot; preview: import("@workspace/api-client-react").PriceEditorPreviewResponse; onBack: () => void; onSave: () => void; saving: boolean }) {
  const prior = preview.dateMeaning.operation === "correction"
    ? preview.existingSameDateValue
    : preview.previousResolvedValue;
  const difference = prior == null ? "First price" : `${snapshot.value - prior >= 0 ? "+" : ""}${money(snapshot.value - prior)}${prior ? ` (${((snapshot.value - prior) / prior * 100).toFixed(1)}%)` : ""}`;
  const operation = preview.dateMeaning.operation;
  const timing = operation === "correction"
    ? `This replaces the existing ${money(preview.existingSameDateValue)} price for this period.`
    : operation === "immediate"
      ? "This takes effect immediately."
      : `It is scheduled; ${money(preview.previousResolvedValue)} remains current until ${date(snapshot.effectiveDate)}.`;
  return <div className="mt-4 rounded-lg border-2 border-[#2d7c78] bg-[#f2fbfa] p-4"><h3 className="font-semibold">Confirm this change</h3><p className="mt-2 text-sm">Change <b>{snapshot.series}</b> for <b>{snapshot.itemCode} ({snapshot.productName})</b> {prior == null ? <><b>as a first price</b></> : <>from <b>{money(prior)}</b></>} to <b>{money(preview.value)}</b>{prior == null ? "" : <> ({difference})</>}, with effect from <b>{date(preview.effectiveDate)}</b>. {timing} {preview.firstCompetitorMapping && "This creates the first competitor mapping for this product."} {preview.competitorGapPct != null && <>The date-aligned gap versus Prayag is <b>{preview.competitorGapPct.toFixed(1)}%</b>.</>} Reason: {snapshot.remarks}</p><div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={onBack}>Back</Button><Button disabled={saving} onClick={onSave}>{saving ? "Saving…" : "Confirm and save"}</Button></div></div>;
}
