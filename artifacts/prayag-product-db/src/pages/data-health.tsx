import {
  useGetCatalogDataHealth,
  useResetCatalog,
  getGetCatalogDataHealthQueryKey,
  getGetCatalogProductsQueryKey,
  getGetCatalogFiltersQueryKey,
} from "@workspace/api-client-react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface MrpSourceHealth {
  id: number;
  division: string;
  sheetUrl: string;
  expectedFileName: string | null;
  notes: string | null;
  fileHashPrefix: string | null;
  downloadedAt: string | null;
  loadedAt: string | null;
  rowCount: number | null;
  liveLinkedRows: number | null;
  rowsRemovedAfterLoad: number | null;
  snapshotAgeDays: number | null;
  isStale: boolean;
  freshnessMessage: string;
}

interface CatalogSyncSummary {
  counts: {
    catalogProducts: number;
    mrpSources: number;
    mrpLoadBatches: number;
    mrpPriceHistory: number;
    mrpHistoryProvenanceEvents: number;
    codeConflicts: number;
    competitorPrices: number;
    competitorCodeAliases: number;
  };
  distinctHistoryCodes: number;
  unlinkedHistoryRows: number;
  discontinuedProducts: number;
  resolvedSparshMappings: number;
}

interface CatalogSyncStatus {
  environment: "development" | "production";
  confirmationPhrase: string;
  current: CatalogSyncSummary;
  recentAudits: Array<{
    id: number;
    bundleSha256: string;
    status: string;
    actorEmail: string;
    startedAt: string;
    completedAt: string | null;
    afterSummary: string | null;
  }>;
}

interface CatalogSyncPreview {
  checksum: string;
  createdAt: string;
  incoming: CatalogSyncSummary;
  current: CatalogSyncSummary;
  preflightToken: string;
  expiresInMinutes: number;
}

function formatDate(value: string | null): string {
  if (!value) return "Not loaded";
  return new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatTimestamp(value: string | null): string {
  if (!value) return "In progress";
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SyncSummary({
  title,
  summary,
}: {
  title: string;
  summary: CatalogSyncSummary;
}) {
  const metrics = [
    ["Products", summary.counts.catalogProducts],
    ["MRP history", summary.counts.mrpPriceHistory],
    ["MRP source batches", summary.counts.mrpLoadBatches],
    ["Provenance events", summary.counts.mrpHistoryProvenanceEvents],
    ["Competitor prices", summary.counts.competitorPrices],
    ["Verified aliases", summary.counts.competitorCodeAliases],
    ["Discontinuations", summary.discontinuedProducts],
    ["Resolved Sparsh mappings", summary.resolvedSparshMappings],
  ] as const;
  return (
    <div className="rounded-md border bg-background p-4">
      <h4 className="mb-3 text-sm font-semibold">{title}</h4>
      <dl className="grid grid-cols-2 gap-x-5 gap-y-2 text-sm">
        {metrics.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-mono font-medium">{value.toLocaleString()}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function CatalogSyncPanel({
  onApplied,
}: {
  onApplied: () => void;
}) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CatalogSyncPreview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [exportedChecksum, setExportedChecksum] = useState<string | null>(null);
  const [completed, setCompleted] = useState<{
    auditId: number;
    completedAt: string;
    checksum: string;
    after: CatalogSyncSummary;
  } | null>(null);

  const statusQuery = useQuery<CatalogSyncStatus | null>({
    queryKey: ["catalog", "sync", "status"],
    retry: false,
    queryFn: async () => {
      const response = await fetch("/api/catalog/sync/status");
      if (response.status === 403) return null;
      if (!response.ok) throw new Error("Could not load catalog sync status.");
      return response.json();
    },
  });
  const status = statusQuery.data;
  if (!status || statusQuery.isError) return null;

  async function readError(response: Response, fallback: string): Promise<string> {
    try {
      const body = (await response.json()) as { error?: string };
      return body.error ?? fallback;
    } catch {
      return fallback;
    }
  }

  async function exportBundle() {
    setIsExporting(true);
    try {
      const response = await fetch("/api/catalog/sync/export");
      if (!response.ok) throw new Error(await readError(response, "Export failed."));
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const fileName =
        disposition.match(/filename="([^"]+)"/)?.[1] ?? "prayag-catalog-sync.json";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);
      const checksum = response.headers.get("X-Catalog-Sync-Sha256");
      setExportedChecksum(checksum);
      toast({
        title: "Catalog bundle downloaded",
        description: checksum
          ? `Checksum ${checksum.slice(0, 12)}…`
          : "Keep this file private until it is imported in production.",
      });
    } catch (error) {
      toast({
        title: "Catalog export failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  }

  async function previewBundle() {
    if (!file) return;
    setIsPreviewing(true);
    setPreview(null);
    setCompleted(null);
    setConfirmation("");
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/catalog/sync/preflight", {
        method: "POST",
        body: form,
      });
      if (!response.ok) {
        throw new Error(await readError(response, "The bundle could not be previewed."));
      }
      setPreview(await response.json());
    } catch (error) {
      toast({
        title: "Bundle rejected",
        description: error instanceof Error ? error.message : "The bundle is invalid.",
        variant: "destructive",
      });
    } finally {
      setIsPreviewing(false);
    }
  }

  async function applyBundle() {
    if (!file || !preview) return;
    setIsApplying(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("preflightToken", preview.preflightToken);
      form.append("confirmation", confirmation);
      const response = await fetch("/api/catalog/sync/apply", {
        method: "POST",
        body: form,
      });
      if (!response.ok) {
        throw new Error(await readError(response, "Production catalog replacement failed."));
      }
      const result = (await response.json()) as {
        auditId: number;
        completedAt: string;
        checksum: string;
        after: CatalogSyncSummary;
      };
      setCompleted(result);
      setPreview(null);
      setConfirmation("");
      await statusQuery.refetch();
      onApplied();
      toast({
        title: "Production catalog replaced",
        description: `Audit #${result.auditId} recorded successfully.`,
      });
    } catch (error) {
      toast({
        title: "Catalog sync failed",
        description:
          error instanceof Error
            ? error.message
            : "Production data was not changed.",
        variant: "destructive",
      });
    } finally {
      setIsApplying(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-lg border border-blue-200 bg-blue-50/40">
      <div className="flex items-start gap-3 border-b border-blue-200 px-5 py-4">
        <ShieldCheck className="mt-0.5 h-5 w-5 text-blue-700" />
        <div>
          <h2 className="font-semibold">Verified catalog production sync</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Administrator-only transfer of catalog records. Accounts, sessions,
            API keys, and application settings are never included.
          </p>
        </div>
      </div>

      <div className="space-y-5 p-5">
        <SyncSummary
          title={
            status.environment === "development"
              ? "Development catalog"
              : "Current production catalog"
          }
          summary={status.current}
        />

        {status.environment === "development" ? (
          <div className="space-y-3">
            <p className="text-sm">
              Download a signed snapshot after verifying the counts above. Import
              this exact file from the published Data Health page.
            </p>
            <Button onClick={exportBundle} disabled={isExporting}>
              {isExporting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              {isExporting ? "Preparing bundle…" : "Download verified bundle"}
            </Button>
            {exportedChecksum && (
              <p className="break-all rounded bg-white/80 px-3 py-2 font-mono text-xs">
                SHA-256: {exportedChecksum}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-2">
              <label className="block text-sm font-medium" htmlFor="catalog-sync-file">
                Development catalog bundle
              </label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  id="catalog-sync-file"
                  type="file"
                  accept=".json,application/json"
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    setPreview(null);
                    setCompleted(null);
                  }}
                  className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
                />
                <Button
                  variant="outline"
                  onClick={previewBundle}
                  disabled={!file || isPreviewing || isApplying}
                >
                  {isPreviewing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-2 h-4 w-4" />
                  )}
                  {isPreviewing ? "Validating…" : "Preview replacement"}
                </Button>
              </div>
            </div>

            {preview && (
              <div className="space-y-4 rounded-lg border border-red-200 bg-red-50 p-4">
                <div>
                  <h3 className="font-semibold text-red-900">
                    Production replacement preview
                  </h3>
                  <p className="mt-1 break-all font-mono text-xs text-red-800">
                    SHA-256: {preview.checksum}
                  </p>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <SyncSummary title="Current production" summary={preview.current} />
                  <SyncSummary title="Incoming development" summary={preview.incoming} />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-red-950">
                    Type{" "}
                    <span className="font-mono">
                      {status.confirmationPhrase}
                    </span>{" "}
                    to continue
                  </label>
                  <input
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    autoComplete="off"
                    className="w-full rounded-md border border-red-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
                <Button
                  variant="destructive"
                  onClick={applyBundle}
                  disabled={
                    isApplying || confirmation !== status.confirmationPhrase
                  }
                >
                  {isApplying && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {isApplying ? "Replacing production catalog…" : "Replace production catalog"}
                </Button>
              </div>
            )}

            {completed && (
              <div className="space-y-3 rounded-lg border border-green-200 bg-green-50 p-4 text-green-950">
                <div className="flex items-center gap-2 font-semibold">
                  <CheckCircle2 className="h-5 w-5" />
                  Production catalog sync completed
                </div>
                <p className="text-sm">
                  Audit reference <span className="font-mono">#{completed.auditId}</span>
                  {" · "}
                  {formatTimestamp(completed.completedAt)}
                </p>
                <p className="break-all font-mono text-xs">
                  Source SHA-256: {completed.checksum}
                </p>
                <SyncSummary title="Resulting production catalog" summary={completed.after} />
              </div>
            )}

            {status.recentAudits.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">Recent sync audits</h3>
                <div className="divide-y rounded-md border bg-background">
                  {status.recentAudits.map((audit) => (
                    <div
                      key={audit.id}
                      className="flex flex-col justify-between gap-1 px-3 py-2 text-sm sm:flex-row"
                    >
                      <span>
                        <span className="font-mono">#{audit.id}</span>{" "}
                        <span
                          className={
                            audit.status === "succeeded"
                              ? "text-green-700"
                              : audit.status === "failed"
                                ? "text-red-700"
                                : "text-amber-700"
                          }
                        >
                          {audit.status}
                        </span>
                      </span>
                      <span className="text-muted-foreground">
                        {formatTimestamp(audit.completedAt ?? audit.startedAt)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export default function DataHealthPage() {
  const { data, isLoading } = useGetCatalogDataHealth();
  const { data: provenance } = useQuery<{ sources: MrpSourceHealth[] }>({
    queryKey: ["catalog", "mrp-provenance"],
    queryFn: async () => {
      const res = await fetch("/api/catalog/mrp-provenance");
      if (!res.ok) throw new Error("Failed to load MRP source provenance");
      return res.json();
    },
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const resetMutation = useResetCatalog({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCatalogDataHealthQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetCatalogProductsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetCatalogFiltersQueryKey() });
        toast({
          title: "Catalog reset",
          description: "The catalog has been restored to its original import.",
        });
      },
      onError: () => {
        toast({
          title: "Reset failed",
          description: "Could not reset the catalog. Please try again.",
          variant: "destructive",
        });
      },
    },
  });
  const invalidateCatalog = () => {
    queryClient.invalidateQueries({ queryKey: getGetCatalogDataHealthQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetCatalogProductsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetCatalogFiltersQueryKey() });
  };

  if (isLoading) {
    return <div className="p-8 text-center">Loading health metrics...</div>;
  }

  if (!data) {
    return <div className="p-8 text-center">No data available</div>;
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Data Health</h1>
          <p className="text-muted-foreground mt-2">
            Monitor catalog integrity and identify missing information.
          </p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" disabled={resetMutation.isPending}>
              <RotateCcw className="w-4 h-4 mr-2" />
              {resetMutation.isPending ? "Resetting..." : "Reset Catalog"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset the catalog?</AlertDialogTitle>
              <AlertDialogDescription>
                This restores all products and MRP price history to the original
                clean import. Any prices or products added through Load MRP since
                then will be removed. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => resetMutation.mutate()}>
                Reset
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <CatalogSyncPanel onApplied={invalidateCatalog} />

      <div className="bg-card border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b bg-muted/20 font-semibold">
          Prayag MRP loader
        </div>
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <span className="text-sm text-muted-foreground">Flagged rows awaiting review</span>
          <span
            className={
              data.flaggedMrpCount > 0
                ? "font-mono text-xl font-bold text-amber-600"
                : "font-mono text-xl font-bold text-green-600"
            }
          >
            {data.flaggedMrpCount}
          </span>
        </div>
      </div>

      <div className="bg-card border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b bg-muted/20">
          <h2 className="font-semibold">MRP source snapshots</h2>
            <p className="text-sm text-muted-foreground mt-1">
             These are the downloaded copies used for price history. “Recorded” never changes; “linked now” reflects documented corrections made after a load.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-4 py-2.5 font-medium">Source</th>
                <th className="px-4 py-2.5 font-medium">File hash</th>
                <th className="px-4 py-2.5 font-medium">Downloaded</th>
                <th className="px-4 py-2.5 font-medium">Loaded</th>
                <th className="px-4 py-2.5 font-medium">Snapshot age</th>
                <th className="px-4 py-2.5 font-medium text-right">Recorded / linked now</th>
              </tr>
            </thead>
            <tbody>
              {(provenance?.sources ?? []).map((source) => (
                <tr
                  key={source.id}
                  className={source.isStale ? "border-t bg-amber-50/70" : "border-t"}
                >
                  <td className="px-4 py-3 align-top">
                    <a
                      href={source.sheetUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-primary hover:underline"
                    >
                      {source.division}
                    </a>
                    {source.isStale && (
                      <p className="mt-1 max-w-sm text-xs text-amber-800">
                        {source.freshnessMessage}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top font-mono text-xs">
                    {source.fileHashPrefix ? `${source.fileHashPrefix}…` : "—"}
                  </td>
                  <td className="px-4 py-3 align-top">{formatDate(source.downloadedAt)}</td>
                  <td className="px-4 py-3 align-top">{formatDate(source.loadedAt)}</td>
                  <td className="px-4 py-3 align-top">
                    {source.snapshotAgeDays == null
                      ? "—"
                      : `${source.snapshotAgeDays} day${source.snapshotAgeDays === 1 ? "" : "s"}`}
                  </td>
                  <td className="px-4 py-3 align-top text-right font-mono">
                    <div>{source.rowCount?.toLocaleString() ?? "—"} / {source.liveLinkedRows?.toLocaleString() ?? "—"}</div>
                    {(source.rowsRemovedAfterLoad ?? 0) > 0 && (
                      <p className="mt-1 text-xs font-sans text-amber-800">
                        {source.rowsRemovedAfterLoad} removed after load
                      </p>
                    )}
                  </td>
                </tr>
              ))}
              {!provenance && (
                <tr>
                  <td className="px-4 py-5 text-muted-foreground" colSpan={6}>
                    Loading source snapshots…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-card border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b bg-muted/20">
          <h2 className="font-semibold">MRP rows without provenance ({data.untracedMrpCount})</h2>
          <p className="text-sm text-muted-foreground mt-1">
            These legacy rows have neither an official workbook batch nor a recorded manual-correction reason. Verify their source before relying on them.
          </p>
        </div>
        <div className="max-h-[360px] overflow-auto">
          {data.untracedMrpRows.length === 0 ? (
            <div className="p-6 text-sm text-green-700">
              Every MRP history row has a traceable source.
            </div>
          ) : (
            <table className="w-full min-w-[680px] text-sm text-left">
              <thead className="sticky top-0 bg-muted/50">
                <tr>
                  <th className="px-4 py-2 font-medium">Item code</th>
                  <th className="px-4 py-2 font-medium">Product</th>
                  <th className="px-4 py-2 font-medium">Effective</th>
                  <th className="px-4 py-2 font-medium text-right">MRP</th>
                  <th className="px-4 py-2 font-medium">Legacy source</th>
                </tr>
              </thead>
              <tbody>
                {data.untracedMrpRows.map((row) => (
                  <tr key={`${row.itemCode}-${row.effectiveDate}`} className="border-t">
                    <td className="px-4 py-2 font-mono">{row.itemCode}</td>
                    <td className="px-4 py-2 text-muted-foreground">{row.productName ?? "—"}</td>
                    <td className="px-4 py-2 font-mono">{row.effectiveDate}</td>
                    <td className="px-4 py-2 text-right font-mono">
                      {row.mrp == null ? "—" : `₹${row.mrp.toFixed(2)}`}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{row.sourceFile ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-card border rounded-lg p-6">
          <div className="text-sm text-muted-foreground mb-2 flex items-center gap-2">
            <Database className="w-4 h-4" />
            Total Products
          </div>
          <div className="text-4xl font-mono font-bold">{data.totalProducts}</div>
        </div>
        
        <div className="bg-card border rounded-lg p-6">
          <div className="text-sm text-muted-foreground mb-2 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            Priced Products
          </div>
          <div className="text-4xl font-mono font-bold text-green-600">
            {data.pricedProducts}
            <span className="text-lg text-muted-foreground ml-2 font-normal">
              ({Math.round((data.pricedProducts / Math.max(1, data.totalProducts)) * 100)}%)
            </span>
          </div>
        </div>

        <div className="bg-card border rounded-lg p-6">
          <div className="text-sm text-muted-foreground mb-2 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            MRP Pending
          </div>
          <div className="text-4xl font-mono font-bold text-amber-600">{data.pendingProducts}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-card border rounded-lg overflow-hidden flex flex-col">
          <div className="p-4 border-b bg-muted/20">
            <h3 className="font-semibold">Missing Prices ({data.missingPriceCount})</h3>
          </div>
          <div className="flex-1 overflow-auto max-h-[500px]">
            {data.missingPrices.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">All products have prices!</div>
            ) : (
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="px-4 py-2 font-medium">Item Code</th>
                    <th className="px-4 py-2 font-medium">Name</th>
                  </tr>
                </thead>
                <tbody>
                  {data.missingPrices.map((p) => (
                    <tr key={p.itemCode} className="border-b last:border-0">
                      <td className="px-4 py-2 font-mono font-medium">{p.itemCode}</td>
                      <td className="px-4 py-2 text-muted-foreground truncate max-w-[200px]">{p.productName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="bg-card border rounded-lg overflow-hidden flex flex-col">
          <div className="p-4 border-b bg-muted/20">
            <h3 className="font-semibold">Code Conflicts ({data.conflictCount})</h3>
          </div>
          <div className="flex-1 overflow-auto max-h-[500px]">
            {data.conflicts.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">No conflicts detected.</div>
            ) : (
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="px-4 py-2 font-medium">Item Code</th>
                    <th className="px-4 py-2 font-medium">Conflicting Names</th>
                  </tr>
                </thead>
                <tbody>
                  {data.conflicts.map((c) => (
                    <tr key={c.itemCode} className="border-b last:border-0">
                      <td className="px-4 py-2 font-mono font-medium text-destructive">{c.itemCode}</td>
                      <td className="px-4 py-2 text-muted-foreground">{c.conflictingNames}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
