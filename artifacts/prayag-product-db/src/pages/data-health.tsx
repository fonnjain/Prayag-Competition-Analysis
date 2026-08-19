import {
  useGetCatalogDataHealth,
  useResetCatalog,
  getGetCatalogDataHealthQueryKey,
  getGetCatalogProductsQueryKey,
  getGetCatalogFiltersQueryKey,
} from "@workspace/api-client-react";
import { AlertTriangle, CheckCircle2, Database, RotateCcw } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
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

function formatDate(value: string | null): string {
  if (!value) return "Not loaded";
  return new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
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
