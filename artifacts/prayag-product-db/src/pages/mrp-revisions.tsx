import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@workspace/replit-auth-web";
import { formatDisplayDate } from "@/lib/date-format";
import { AlertTriangle, ArchiveX, CheckCircle2, FileSpreadsheet, RotateCcw, Upload } from "lucide-react";

type RevisionRow = {
  id: number;
  rowNumber: number;
  itemCode: string | null;
  effectiveDate: string | null;
  variant: string;
  competitor: string | null;
  previousValue: number | null;
  newValue: number | null;
  outcome: "change" | "noop" | "rejected";
  rejectionReason: string | null;
  warningReasons: string | null;
};

type RevisionPreview = {
  batchId: number;
  targetType: "mrp" | "competitor";
  competitor: string | null;
  effectiveDate: string | null;
  fileName: string;
  fileSha256: string;
  rowsInFile: number;
  rowsChanged: number;
  rowsNoop: number;
  rowsRejected: number;
  warningCount: number;
  hasEffectiveDateColumn: boolean;
  dateMismatchCount: number;
  dateMismatchDates: string[];
  status: "preview" | "applied" | "discarded" | "rolled_back";
  rows: RevisionRow[];
};

type RevisionScope = {
  effectiveDate: string;
  rowCount: number;
  endsOn: string | null;
};

type MrpRevisionScope = RevisionScope & {
  division: string | null;
};

type CompetitorRevisionScope = RevisionScope & {
  competitor: string;
};

type RevisionScopes = {
  mrpPeriods: MrpRevisionScope[];
  competitorPeriods: CompetitorRevisionScope[];
};

function warningText(row: RevisionRow) {
  if (!row.warningReasons) return [];
  try {
    return JSON.parse(row.warningReasons) as string[];
  } catch {
    return [row.warningReasons];
  }
}

function money(value: number | null) {
  return value == null ? "—" : `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function periodContext(scope: RevisionScope, division?: string | null) {
  const context = [
    formatDisplayDate(scope.effectiveDate),
    division,
    `${scope.rowCount.toLocaleString("en-IN")} rows`,
    scope.endsOn ? `in force until ${formatDisplayDate(scope.endsOn)}` : "currently open-ended",
  ].filter(Boolean);
  return context.join(" · ");
}

export default function MrpRevisionsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [targetType, setTargetType] = useState<"mrp" | "competitor">("mrp");
  const [file, setFile] = useState<File | null>(null);
  const [competitor, setCompetitor] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<RevisionPreview | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const scopes = useQuery<RevisionScopes>({
    queryKey: ["catalog", "mrp-revisions", "scopes"],
    queryFn: async () => {
      const response = await fetch("/api/catalog/mrp-revisions/scopes");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load revision periods.");
      return data;
    },
  });
  const competitorPeriods = (scopes.data?.competitorPeriods ?? [])
    .filter((scope) => scope.competitor === competitor)
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
  const selectedScope =
    targetType === "mrp"
      ? scopes.data?.mrpPeriods.find((scope) => scope.effectiveDate === effectiveDate)
      : competitorPeriods.find((scope) => scope.effectiveDate === effectiveDate);

  const previewWorkbook = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) return;
    if (!reason.trim()) {
      toast({ title: "Add a reason", description: "A short audit reason is required before previewing.", variant: "destructive" });
      return;
    }
    if (!effectiveDate || (targetType === "competitor" && !competitor)) {
      toast({ title: "Choose a revision scope", description: "Select an existing period before creating a preview.", variant: "destructive" });
      return;
    }
    setIsPreviewing(true);
    setPreview(null);
    setAcknowledged(false);
    const body = new FormData();
    body.append("file", file);
    body.append("targetType", targetType);
    body.append("reason", reason.trim());
    body.append("effectiveDate", effectiveDate);
    if (targetType === "competitor") {
      body.append("competitor", competitor.trim());
    }
    try {
      const response = await fetch("/api/catalog/mrp-revisions/preview", { method: "POST", body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create revision preview.");
      setPreview({ ...data, status: data.status ?? "preview" });
    } catch (error: any) {
      toast({ title: "Preview failed", description: error.message, variant: "destructive" });
    } finally {
      setIsPreviewing(false);
    }
  };

  const applyPreview = async () => {
    if (!preview) return;
    const confirmed = window.confirm([
      "Apply this revision batch?",
      "",
      `Will change: ${preview.rowsChanged}`,
      `No-op: ${preview.rowsNoop}`,
      `Rejected: ${preview.rowsRejected}`,
      "",
      "Only rows marked Will change will be written.",
    ].join("\n"));
    if (!confirmed) return;
    setIsApplying(true);
    try {
      const response = await fetch(`/api/catalog/mrp-revisions/${preview.batchId}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acknowledgeWarnings: acknowledged }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not apply revision.");
      setPreview((current) => current ? { ...current, status: "applied" } : current);
      queryClient.invalidateQueries();
      toast({ title: "Revision applied", description: `${data.rowsChanged} existing price row(s) were updated.` });
    } catch (error: any) {
      toast({ title: "Revision not applied", description: error.message, variant: "destructive" });
    } finally {
      setIsApplying(false);
    }
  };

  const discardPreview = async () => {
    if (!preview) return;
    const confirmed = window.confirm([
      "Discard this revision preview?",
      "",
      `${preview.rowsInFile} uploaded row(s) will remain viewable, but no price changes can be applied from this batch.`,
    ].join("\n"));
    if (!confirmed) return;
    setIsDiscarding(true);
    try {
      const response = await fetch(`/api/catalog/mrp-revisions/${preview.batchId}/discard`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not discard revision.");
      setPreview((current) => current ? { ...current, status: "discarded" } : current);
      toast({ title: "Preview discarded", description: "The audited preview remains available below, and no prices were changed." });
    } catch (error: any) {
      toast({ title: "Preview not discarded", description: error.message, variant: "destructive" });
    } finally {
      setIsDiscarding(false);
    }
  };

  const rollback = async () => {
    if (!preview) return;
    setIsRollingBack(true);
    try {
      const response = await fetch(`/api/catalog/mrp-revisions/${preview.batchId}/rollback`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not roll back revision.");
      setPreview((current) => current ? { ...current, status: "rolled_back" } : current);
      queryClient.invalidateQueries();
      toast({ title: "Revision rolled back", description: `${data.rowsRolledBack} prior value(s) were restored exactly.` });
    } catch (error: any) {
      toast({ title: "Rollback not performed", description: error.message, variant: "destructive" });
    } finally {
      setIsRollingBack(false);
    }
  };

  if (user?.role !== "admin") {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Administrator access required</AlertTitle>
          <AlertDescription>Revision uploads can change prices already in force and are only available to administrators.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-7 p-5 sm:p-8">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#2d7c78]">Controlled correction</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Price revision upload</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Choose an existing period before uploading. Workbook dates are checked against that choice, so this tool cannot create a product or a price period.
        </p>
      </div>

      <form data-activity="mrp_revision.preview" onSubmit={previewWorkbook} className="grid gap-5 rounded-xl border bg-card p-5 shadow-sm lg:grid-cols-[1fr_1fr]">
        <div className="space-y-2">
          <Label>Revision type</Label>
          <Select value={targetType} onValueChange={(value) => {
            setTargetType(value as "mrp" | "competitor");
            setEffectiveDate("");
            setPreview(null);
          }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="mrp">Prayag MRP</SelectItem>
              <SelectItem value="competitor">Competitor price</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">The workbook must contain only the <span className="font-mono">revision</span> sheet data you intend to correct.</p>
        </div>
        {scopes.isLoading ? (
          <div className="flex items-center gap-3 rounded-lg border border-dashed bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            <FileSpreadsheet className="h-5 w-5 text-[#2d7c78]" />
            Loading existing revision periods…
          </div>
        ) : scopes.isError ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Revision periods could not load</AlertTitle>
            <AlertDescription>{scopes.error instanceof Error ? scopes.error.message : "Reload the page before uploading a revision."}</AlertDescription>
          </Alert>
        ) : targetType === "competitor" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Competitor</Label>
              <Select value={competitor} onValueChange={(value) => { setCompetitor(value); setEffectiveDate(""); setPreview(null); }}>
                <SelectTrigger><SelectValue placeholder="Choose a competitor" /></SelectTrigger>
                <SelectContent>
                  {[...new Set((scopes.data?.competitorPeriods ?? []).map((scope) => scope.competitor))]
                    .sort((a, b) => a.localeCompare(b))
                    .map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Existing effective period</Label>
              <Select value={effectiveDate} onValueChange={(value) => { setEffectiveDate(value); setPreview(null); }} disabled={!competitor}>
                <SelectTrigger><SelectValue placeholder={competitor ? "Choose a period" : "Choose a competitor first"} /></SelectTrigger>
                <SelectContent>
                  {competitorPeriods.map((scope) => (
                    <SelectItem key={scope.effectiveDate} value={scope.effectiveDate}>
                      {periodContext(scope)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <Label>Existing effective period</Label>
            <Select value={effectiveDate} onValueChange={(value) => { setEffectiveDate(value); setPreview(null); }}>
              <SelectTrigger><SelectValue placeholder="Choose the MRP period to correct" /></SelectTrigger>
              <SelectContent>
                {(scopes.data?.mrpPeriods ?? [])
                  .slice()
                  .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))
                  .map((scope) => (
                    <SelectItem key={scope.effectiveDate} value={scope.effectiveDate}>
                      {periodContext(scope, scope.division)}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {selectedScope && (
          <div className="lg:col-span-2 rounded-lg border border-[#2d7c78]/30 bg-[#2d7c78]/5 px-4 py-3 text-sm">
            <p className="font-medium text-[#1d5d5a]">Selected revision scope</p>
            <p className="mt-1 text-muted-foreground">
              {periodContext(
                selectedScope,
                "division" in selectedScope ? selectedScope.division : competitor,
              )}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Workbook dates must match this period. If the workbook has no effective-date column, this selected period is applied to every uploaded row.
            </p>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="revision-file">Revision workbook</Label>
          <Input id="revision-file" type="file" accept=".xlsx,.xls" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="revision-reason">Reason for this revision</Label>
          <Textarea id="revision-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain why this correction is needed" rows={2} />
        </div>
        <div className="lg:col-span-2 flex flex-wrap items-center justify-between gap-3 border-t pt-5">
          <p className="text-xs text-muted-foreground">Preview does not write prices. Only Apply changes existing values.</p>
          <Button type="submit" disabled={!file || !reason.trim() || !selectedScope || (targetType === "competitor" && !competitor) || scopes.isLoading || scopes.isError || isPreviewing}>
            <Upload className="mr-2 h-4 w-4" />
            {isPreviewing ? "Reading workbook…" : "Create read-only preview"}
          </Button>
        </div>
      </form>

      {preview && (
        <section className="space-y-5">
          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preview batch {preview.batchId}</p>
                <h2 className="mt-1 font-semibold">{preview.fileName}</h2>
                <p className="mt-1 font-mono text-xs text-muted-foreground">SHA-256 {preview.fileSha256}</p>
              </div>
              <div className="text-sm font-medium text-muted-foreground">
                {preview.status === "applied" ? "Applied" : preview.status === "rolled_back" ? "Rolled back" : preview.status === "discarded" ? "Discarded" : "Not applied"}
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Rows in file", preview.rowsInFile],
                ["Will change", preview.rowsChanged],
                ["No-op", preview.rowsNoop],
                ["Rejected", preview.rowsRejected],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-lg bg-muted/45 p-3">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-1 text-xl font-bold">{value}</p>
                </div>
              ))}
            </div>
            <p className="mt-4 text-sm font-semibold text-foreground">
              {preview.rowsInFile} rows · {preview.rowsChanged} will change · {preview.rowsNoop} no-ops · {preview.rowsRejected} rejected
            </p>
            {preview.dateMismatchCount > 0 && (
              <Alert variant="destructive" className="mt-5">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>
                  {preview.dateMismatchCount} row{preview.dateMismatchCount === 1 ? "" : "s"} do not match the selected period {formatDisplayDate(preview.effectiveDate)}
                </AlertTitle>
                <AlertDescription>
                  Workbook date{preview.dateMismatchDates.length === 1 ? "" : "s"} {preview.dateMismatchDates.map(formatDisplayDate).join(", ")} {preview.dateMismatchDates.length === 1 ? "does" : "do"} not match the selected scope. These rows will not be applied.
                  {preview.dateMismatchCount === preview.rowsInFile && " Every uploaded row was rejected for this mismatch; choose the matching period or upload the matching workbook."}
                </AlertDescription>
              </Alert>
            )}
            {preview.rowsChanged === 0 && preview.rowsRejected === 0 && (
              <p className="mt-1 text-sm text-emerald-700">All stored values already match the file. Nothing needs to be written.</p>
            )}
            {preview.warningCount > 0 && (
              <Alert className="mt-5 border-amber-500/50 bg-amber-50 text-amber-950">
                <AlertTriangle className="h-4 w-4 text-amber-700" />
                <AlertTitle>{preview.warningCount} plausibility warning{preview.warningCount === 1 ? "" : "s"}</AlertTitle>
                <AlertDescription>Review the flagged rows below. These warnings are not blocking, but an administrator must acknowledge them before applying.</AlertDescription>
              </Alert>
            )}
            {preview.status === "preview" && (
              <div className="mt-5 flex flex-wrap items-center justify-end gap-4 border-t pt-5">
                {preview.warningCount > 0 && (
                  <label className="flex max-w-xl items-start gap-2 text-sm">
                    <Checkbox checked={acknowledged} onCheckedChange={(value) => setAcknowledged(value === true)} className="mt-0.5" />
                    <span>I reviewed the warnings and confirm these corrections are intentional.</span>
                  </label>
                )}
                <div className="flex flex-wrap items-center justify-end gap-3">
                  {preview.rowsChanged === 0 && (
                    <p className="max-w-xs text-right text-xs text-muted-foreground">
                      {preview.rowsRejected > 0
                        ? `Nothing to apply: ${preview.rowsInFile} rows, ${preview.rowsNoop} no-ops, ${preview.rowsRejected} rejected.`
                        : `Nothing to apply: ${preview.rowsInFile} rows, all no-ops.`}
                    </p>
                  )}
                  <Button
                    variant="outline"
                    disabled={isApplying || isDiscarding}
                    onClick={discardPreview}
                    data-activity="mrp_revision.discard"
                  >
                    <ArchiveX className="mr-2 h-4 w-4" />
                    {isDiscarding ? "Discarding…" : "Discard"}
                  </Button>
                  <Button disabled={isApplying || isDiscarding || preview.rowsChanged === 0 || (preview.warningCount > 0 && !acknowledged)} onClick={applyPreview} data-activity="mrp_revision.apply">
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  {isApplying ? "Applying…" : `Apply ${preview.rowsChanged} change${preview.rowsChanged === 1 ? "" : "s"}`}
                  </Button>
                </div>
              </div>
            )}
            {preview.status === "applied" && (
              <div className="mt-5 flex justify-end border-t pt-5">
                <Button variant="outline" disabled={isRollingBack} onClick={rollback} data-activity="mrp_revision.rollback">
                  <RotateCcw className="mr-2 h-4 w-4" />
                  {isRollingBack ? "Restoring…" : "Rollback this batch"}
                </Button>
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="border-b px-5 py-4">
              <h2 className="font-semibold">Row-by-row outcome</h2>
              <p className="mt-1 text-sm text-muted-foreground">Only rows marked “Will change” are written when you apply this batch.</p>
            </div>
            <div className="max-h-[34rem] overflow-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="sticky top-0 bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Row</th><th className="px-4 py-3">Code</th><th className="px-4 py-3">Period / variant</th><th className="px-4 py-3">Current</th><th className="px-4 py-3">New</th><th className="px-4 py-3">Outcome</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {preview.rows.map((row) => {
                    const warnings = warningText(row);
                    const delta = row.previousValue != null && row.newValue != null ? row.newValue - row.previousValue : null;
                    return (
                      <tr key={row.id} className={row.outcome === "rejected" ? "bg-destructive/5" : warnings.length ? "bg-amber-50/70" : ""}>
                        <td className="px-4 py-3 font-mono text-xs">{row.rowNumber}</td>
                        <td className="px-4 py-3 font-mono">{row.itemCode ?? "—"}</td>
                        <td className="px-4 py-3"><div>{formatDisplayDate(row.effectiveDate)}</div><div className="text-xs text-muted-foreground">{row.variant}</div></td>
                        <td className="px-4 py-3">{money(row.previousValue)}</td>
                        <td className="px-4 py-3">{money(row.newValue)} {delta != null && <span className="ml-1 text-xs text-muted-foreground">({delta > 0 ? "+" : ""}{delta.toFixed(2)})</span>}</td>
                        <td className="max-w-sm px-4 py-3">
                          <span className={row.outcome === "change" ? "font-medium text-emerald-700" : row.outcome === "noop" ? "font-medium text-slate-600" : "font-medium text-destructive"}>
                            {row.outcome === "change" ? "Will change" : row.outcome === "noop" ? "No-op" : "Rejected"}
                          </span>
                          {row.rejectionReason && <p className="mt-1 text-xs text-destructive">{row.rejectionReason}</p>}
                          {warnings.map((warning) => <p key={warning} className="mt-1 text-xs text-amber-800">{warning}</p>)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}