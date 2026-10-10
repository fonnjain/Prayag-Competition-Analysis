import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@workspace/replit-auth-web";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, ShieldAlert, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";

type BatchStatus = "preview" | "applied" | "undone";
interface Batch {
  id: number;
  status: BatchStatus;
  brands: string[];
  fileName: string;
  contentFingerprint: string;
  createdAt: string;
  appliedAt?: string | null;
  undoneAt?: string | null;
  expiresAt?: string | null;
  summary: {
    eligible: number;
    inserted: number;
    unchanged: number;
    conflicts: number;
    periods: { competitor: string; effectiveDate: string; rows: number }[];
  };
  refused: { sheet: string; row: number; competitor: string; prayagCode: string; competitorCode: string; reason: string }[];
  unitSummary: { sheet: string; competitor: string; columns: string[]; units: string[] }[];
  nameResolutions: { requested: string; stored: string }[];
  blockers: string[];
}
interface Inspection { brands: string[]; sheets: string[]; protectedBrands: string[] }

const BASE = "/api/catalog/workbook-loads";

function getAuthHeaders(): Record<string, string> {
  try {
    const sid = localStorage.getItem("prayag_sid");
    if (sid) return { Authorization: `Bearer ${sid}` };
  } catch { /* ignore */ }
  return {};
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: { ...getAuthHeaders(), ...(init.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error || (data as any).message || `Request failed (${res.status})`);
  return data as T;
}

function fmt(iso?: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-GB");
}

const statusClass: Record<BatchStatus, string> = {
  preview: "bg-blue-50 text-blue-900 border-blue-200",
  applied: "bg-emerald-50 text-emerald-900 border-emerald-200",
  undone: "bg-muted text-muted-foreground border-border",
};

export default function WorkbookLoadsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [, navigate] = useLocation();
  const search = useSearch();
  const batchParam = new URLSearchParams(search).get("batch");
  const batchId = batchParam && /^\d+$/.test(batchParam) ? Number(batchParam) : null;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<null | "inspect" | "preview" | "apply" | "undo">(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [showUndo, setShowUndo] = useState(false);
  const [undoReason, setUndoReason] = useState("");
  const [expandRefused, setExpandRefused] = useState(false);

  const history = useQuery({
    queryKey: ["workbook-loads"],
    queryFn: () => call<{ batches: Batch[] }>("/"),
    enabled: isAdmin,
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
  });
  const detail = useQuery({
    queryKey: ["workbook-loads", batchId],
    queryFn: () => call<Batch>(`/${batchId}`),
    enabled: isAdmin && batchId !== null,
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
  });
  const batch = detail.data ?? null;

  useEffect(() => { setConfirmed(false); setExpandRefused(false); }, [batchId]);

  const setBatchParam = (id: number | null) => navigate(id ? `/workbook-loads?batch=${id}` : "/workbook-loads");

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["workbook-loads"] });
    // Product, analysis and competitor caches (generated hook keys live under /api paths).
    queryClient.invalidateQueries({
      predicate: (q) => {
        const k = JSON.stringify(q.queryKey);
        return k.includes("/api/catalog") || k.includes("/api/analysis") || k.includes("/api/products") || k.includes("comparison");
      },
    });
  };

  const protectedSet = useMemo(
    () => new Set((inspection?.protectedBrands ?? []).map((b) => b.toLowerCase())),
    [inspection],
  );

  const onPick = (f: File | null) => {
    setFile(f);
    setInspection(null);
    setSelected(new Set());
    setError(null);
  };

  const runInspect = async () => {
    if (!file) return;
    setBusy("inspect"); setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const data = await call<Inspection>("/inspect", { method: "POST", body: fd });
      setInspection(data);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Inspect failed.");
    } finally { setBusy(null); }
  };

  const runPreview = async () => {
    if (!file || selected.size === 0) return;
    setBusy("preview"); setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("brands", JSON.stringify([...selected]));
      const data = await call<Batch>("/preview", { method: "POST", body: fd });
      queryClient.setQueryData(["workbook-loads", data.id], data);
      queryClient.invalidateQueries({ queryKey: ["workbook-loads"] });
      setBatchParam(data.id);
      toast({ title: "Preview created", description: "Nothing has been written. Review before applying." });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed.");
    } finally { setBusy(null); }
  };

  const applyBlockedReason = (b: Batch): string | null => {
    if (b.status !== "preview") return `This batch is ${b.status}.`;
    if (b.blockers.length > 0) return "Blockers must be resolved first.";
    if (b.summary.conflicts > 0) return "Conflicts must be resolved first.";
    if (b.summary.inserted === 0) return "Zero rows would be inserted; nothing to apply.";
    return null;
  };

  const runApply = async () => {
    if (!batch || !file) return;
    setBusy("apply"); setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("contentFingerprint", batch.contentFingerprint);
      const data = await call<Batch>(`/${batch.id}/apply`, { method: "POST", body: fd });
      queryClient.setQueryData(["workbook-loads", data.id], data);
      invalidateAll();
      setConfirmed(false);
      toast({ title: "Load applied", description: `${data.summary.inserted} rows inserted.` });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Apply failed.");
    } finally { setBusy(null); }
  };

  const runUndo = async () => {
    if (!batch || !undoReason.trim()) return;
    setBusy("undo"); setError(null);
    try {
      const data = await call<Batch>(`/${batch.id}/undo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: undoReason.trim() }),
      });
      queryClient.setQueryData(["workbook-loads", data.id], data);
      invalidateAll();
      setShowUndo(false); setUndoReason("");
      toast({ title: "Load undone" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Undo failed.");
      setShowUndo(false);
    } finally { setBusy(null); }
  };

  if (!isAdmin) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center justify-center gap-3 p-8 pt-28 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-800">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Administrator access required</h1>
        <p className="max-w-lg text-sm text-muted-foreground">
          Workbook loads change competitor prices. Only administrators can use this page.
        </p>
      </div>
    );
  }

  const blocked = batch ? applyBlockedReason(batch) : null;
  const fileMatches = batch && file ? file.name === batch.fileName : false;
  const byBrand = batch
    ? batch.brands.map((brand) => ({
        brand,
        periods: batch.summary.periods.filter((p) => p.competitor === brand),
      }))
    : [];

  return (
    <div className="min-w-0 w-full p-4 sm:p-8 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Workbook Loads</h1>
        <p className="text-muted-foreground mt-2">
          Load several competitor brands and price periods from one workbook. Upload, inspect, choose
          detected brands, review an immutable preview, then apply explicitly.
        </p>
      </div>

      {error && (
        <div data-testid="text-workbook-error" role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      )}

      <section className="min-w-0 bg-card border rounded-lg p-4 sm:p-6 space-y-5">
        <h2 className="text-lg font-semibold">1. Upload and inspect</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="workbook-file">Workbook file</Label>
            <Input
              id="workbook-file"
              data-testid="input-workbook-file"
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              disabled={busy !== null}
              onChange={(e) => onPick(e.target.files?.[0] ?? null)}
            />
          </div>
          <Button data-testid="button-inspect" disabled={!file || busy !== null} onClick={runInspect}>
            {busy === "inspect" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Inspect workbook
          </Button>
        </div>

        {inspection && (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Sheets: {inspection.sheets.join(", ") || "none"}
            </p>
            {inspection.brands.length === 0 ? (
              <p className="text-sm text-muted-foreground">No brands were detected in this workbook.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {inspection.brands.map((brand) => {
                  const isProtected = protectedSet.has(brand.toLowerCase());
                  return (
                    <label
                      key={brand}
                      className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm ${isProtected ? "bg-muted/50 text-muted-foreground" : "cursor-pointer hover:bg-muted/40"}`}
                    >
                      <Checkbox
                        data-testid={`checkbox-brand-${brand}`}
                        disabled={isProtected || busy !== null}
                        checked={selected.has(brand)}
                        onCheckedChange={(v) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (v) next.add(brand); else next.delete(brand);
                            return next;
                          })
                        }
                      />
                      <span className="flex-1">{brand}</span>
                      {isProtected && <span className="text-xs">Protected</span>}
                    </label>
                  );
                })}
              </div>
            )}
            {inspection.protectedBrands.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Protected brands cannot be selected or changed here: {inspection.protectedBrands.join(", ")}.
              </p>
            )}
            <Button data-testid="button-preview" disabled={selected.size === 0 || busy !== null} onClick={runPreview}>
              {busy === "preview" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create preview ({selected.size} {selected.size === 1 ? "brand" : "brands"})
            </Button>
          </div>
        )}
      </section>

      {batchId !== null && (
        <section className="min-w-0 bg-card border rounded-lg p-4 sm:p-6 space-y-6" data-testid="panel-batch">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-lg font-semibold">Batch #{batchId}</h2>
            <Button variant="ghost" size="sm" onClick={() => setBatchParam(null)}>Close</Button>
          </div>
          {detail.isLoading && <Skeleton className="h-40 w-full" />}
          {detail.isError && (
            <div className="text-sm text-red-900">
              {(detail.error as Error).message}{" "}
              <Button size="sm" variant="outline" onClick={() => detail.refetch()}>Retry</Button>
            </div>
          )}
          {batch && (
            <>
              <div className="space-y-1 text-sm">
                <div className="min-w-0 flex items-start gap-2">
                  <span data-testid="status-batch" className={`shrink-0 rounded border px-2 py-0.5 text-xs font-medium ${statusClass[batch.status]}`}>
                    {batch.status}
                  </span>
                  <span className="min-w-0 break-all font-medium">{batch.fileName}</span>
                </div>
                <p className="text-muted-foreground">Brands: {batch.brands.join(", ")}</p>
                <p className="text-muted-foreground break-all">
                  Fingerprint: <span data-testid="text-fingerprint" className="break-all font-mono text-xs">{batch.contentFingerprint}</span>
                </p>
                <p className="text-muted-foreground">
                  Created {fmt(batch.createdAt)}
                  {batch.expiresAt && batch.status === "preview" ? ` - expires ${fmt(batch.expiresAt)}` : ""}
                  {batch.appliedAt ? ` - applied ${fmt(batch.appliedAt)}` : ""}
                  {batch.undoneAt ? ` - undone ${fmt(batch.undoneAt)}` : ""}
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {([
                  ["Eligible", batch.summary.eligible],
                  ["Inserted", batch.summary.inserted],
                  ["Unchanged", batch.summary.unchanged],
                  ["Conflicts", batch.summary.conflicts],
                ] as const).map(([label, n]) => (
                  <div key={label} className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="text-xl font-semibold" data-testid={`count-${label.toLowerCase()}`}>{n}</div>
                  </div>
                ))}
              </div>

              {batch.blockers.length > 0 && (
                <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900" data-testid="list-blockers">
                  <p className="font-medium">Blockers</p>
                  <ul className="list-disc pl-5">{batch.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
                </div>
              )}

              {batch.nameResolutions.length > 0 && (
                <div className="text-sm">
                  <p className="font-medium">Brand name resolutions</p>
                  <ul className="list-disc pl-5 text-muted-foreground">
                    {batch.nameResolutions.map((n, i) => <li key={i}>{n.requested} stored as {n.stored}</li>)}
                  </ul>
                </div>
              )}

              <div>
                <h3 className="font-medium mb-2">Rows per brand and period</h3>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left">
                      <tr><th className="p-2">Brand</th><th className="p-2">Effective date</th><th className="p-2 text-right">Rows</th></tr>
                    </thead>
                    <tbody>
                      {byBrand.map(({ brand, periods }) =>
                        periods.length === 0 ? (
                          <tr key={brand} className="border-t"><td className="p-2">{brand}</td><td className="p-2 text-muted-foreground">No periods</td><td className="p-2 text-right">0</td></tr>
                        ) : (
                          periods.map((p) => (
                            <tr key={`${brand}-${p.effectiveDate}`} className="border-t">
                              <td className="p-2">{brand}</td>
                              <td className="p-2">{p.effectiveDate}</td>
                              <td className="p-2 text-right">{p.rows}</td>
                            </tr>
                          ))
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h3 className="font-medium mb-2">Unit review</h3>
                {batch.unitSummary.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No unit information reported.</p>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-left">
                        <tr><th className="p-2">Sheet</th><th className="p-2">Brand</th><th className="p-2">Columns</th><th className="p-2">Units</th></tr>
                      </thead>
                      <tbody>
                        {batch.unitSummary.map((u, i) => (
                          <tr key={i} className="border-t">
                            <td className="p-2">{u.sheet}</td>
                            <td className="p-2">{u.competitor}</td>
                            <td className="p-2">{u.columns.join(", ")}</td>
                            <td className="p-2">{u.units.join(", ")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div>
                <button
                  type="button"
                  data-testid="button-toggle-refused"
                  className="flex items-center gap-1 font-medium"
                  onClick={() => setExpandRefused((v) => !v)}
                >
                  {expandRefused ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  Refused rows ({batch.refused.length})
                </button>
                {expandRefused && (
                  <div className="mt-2 overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-left">
                        <tr>
                          <th className="p-2">Sheet</th><th className="p-2">Row</th><th className="p-2">Brand</th>
                          <th className="p-2">Prayag code</th><th className="p-2">Competitor code</th><th className="p-2">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {batch.refused.map((r, i) => (
                          <tr key={i} className="border-t">
                            <td className="p-2">{r.sheet}</td><td className="p-2">{r.row}</td><td className="p-2">{r.competitor}</td>
                            <td className="p-2">{r.prayagCode}</td><td className="p-2">{r.competitorCode}</td><td className="p-2">{r.reason}</td>
                          </tr>
                        ))}
                        {batch.refused.length === 0 && (
                          <tr><td className="p-3 text-muted-foreground" colSpan={6}>No refused rows.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {batch.status === "preview" && (
                <div className="rounded-md border p-4 space-y-3">
                  <h3 className="font-medium">Apply</h3>
                  <p className="text-sm text-muted-foreground">
                    After a reload the browser forgets the file. Reattach the original workbook ({batch.fileName}); the server checks it against the fingerprint.
                  </p>
                  <Input
                    data-testid="input-reattach-file"
                    type="file"
                    accept=".xlsx,.xls"
                    disabled={busy !== null}
                    onChange={(e) => { setFile(e.target.files?.[0] ?? null); setConfirmed(false); }}
                  />
                  {file && !fileMatches && (
                    <p className="text-xs text-amber-800">The attached file name differs from the previewed file.</p>
                  )}
                  {blocked && <p className="text-sm text-red-900" data-testid="text-apply-blocked">{blocked}</p>}
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox
                      data-testid="checkbox-confirm-apply"
                      checked={confirmed}
                      disabled={Boolean(blocked) || busy !== null}
                      onCheckedChange={(v) => setConfirmed(v === true)}
                    />
                    <span>
                      I reviewed the periods, units and refused rows, and I want to insert {batch.summary.inserted} price rows for {batch.brands.join(", ")}.
                    </span>
                  </label>
                  <Button
                    data-testid="button-apply"
                    disabled={Boolean(blocked) || !confirmed || !file || busy !== null}
                    onClick={runApply}
                  >
                    {busy === "apply" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Apply load
                  </Button>
                </div>
              )}

              {batch.status === "applied" && (
                <Button data-testid="button-undo" variant="destructive" disabled={busy !== null} onClick={() => setShowUndo(true)}>
                  Undo this load
                </Button>
              )}
            </>
          )}
        </section>
      )}

      <section className="bg-card border rounded-lg p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">History</h2>
          <Button variant="outline" size="sm" data-testid="button-refresh-history" onClick={() => history.refetch()} disabled={history.isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${history.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
        {history.isLoading && <Skeleton className="h-24 w-full" />}
        {history.isError && (
          <div className="text-sm text-red-900">
            {(history.error as Error).message}{" "}
            <Button size="sm" variant="outline" onClick={() => history.refetch()}>Retry</Button>
          </div>
        )}
        {history.data && history.data.batches.length === 0 && (
          <p className="text-sm text-muted-foreground">No workbook loads yet. Inspect a workbook above to begin.</p>
        )}
        {history.data && history.data.batches.length > 0 && (
          <ul className="divide-y rounded-md border">
            {history.data.batches.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 p-3 text-sm" data-testid={`row-batch-${b.id}`}>
                <span className="font-mono text-xs">#{b.id}</span>
                <span className={`rounded border px-2 py-0.5 text-xs font-medium ${statusClass[b.status]}`}>{b.status}</span>
                <div className="flex-1 min-w-[12rem]">
                  <div className="font-medium">{b.fileName}</div>
                  <div className="text-xs text-muted-foreground">
                    {b.brands.join(", ")} - {fmt(b.appliedAt ?? b.createdAt)} - {b.summary.inserted} inserted
                  </div>
                </div>
                <Button size="sm" variant="outline" data-testid={`button-open-batch-${b.id}`} onClick={() => setBatchParam(b.id)}>
                  {b.status === "preview" ? "Reopen" : "Inspect"}
                </Button>
                {b.status === "applied" && (
                  <Button
                    size="sm"
                    variant="destructive"
                    data-testid={`button-undo-batch-${b.id}`}
                    disabled={busy !== null}
                    onClick={() => { setBatchParam(b.id); setShowUndo(true); }}
                  >
                    Undo
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <AlertDialog open={showUndo} onOpenChange={(o) => { if (busy !== "undo") setShowUndo(o); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Undo batch #{batchId}?</AlertDialogTitle>
            <AlertDialogDescription>
              Only rows from this batch that are still unchanged can be undone. If any were edited since, the server will refuse the undo. A reason is required.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Label htmlFor="undo-reason">Reason</Label>
          <Input id="undo-reason" data-testid="input-undo-reason" value={undoReason} onChange={(e) => setUndoReason(e.target.value)} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "undo"}>Cancel</AlertDialogCancel>
            <Button
              data-testid="button-confirm-undo"
              variant="destructive"
              disabled={!undoReason.trim() || busy !== null || !batch || batch.id !== batchId}
              onClick={runUndo}
            >
              {busy === "undo" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirm undo
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
