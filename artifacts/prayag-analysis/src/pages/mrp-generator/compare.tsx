import React, { useState } from "react";
import { useCompareMrpGeneratorRuns, getCompareMrpGeneratorRunsQueryKey, useListMrpGeneratorRuns } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRightLeft } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export default function MrpGeneratorCompare() {
  const [leftRunId, setLeftRunId] = useState("");
  const [rightRunId, setRightRunId] = useState("");
  const [submittedIds, setSubmittedIds] = useState<{ left: number; right: number } | null>(null);

  const { data: runsData } = useListMrpGeneratorRuns({ limit: 10 });
  const recentRuns = runsData?.runs || [];

  const { data, isLoading, error } = useCompareMrpGeneratorRuns(
    { leftRunId: submittedIds?.left as number, rightRunId: submittedIds?.right as number },
    { query: { enabled: !!submittedIds, queryKey: submittedIds ? getCompareMrpGeneratorRunsQueryKey({ leftRunId: submittedIds.left, rightRunId: submittedIds.right }) : ["compare-mrp-runs", "none"] } }
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const l = parseInt(leftRunId);
    const r = parseInt(rightRunId);
    if (!isNaN(l) && !isNaN(r)) {
      setSubmittedIds({ left: l, right: r });
    }
  };

  const differences = data?.differences || [];

  return (
    <div className="flex flex-col min-h-full bg-muted/20">
      <div className="border-b bg-card px-4 py-3 sm:px-6">
        <h1 className="text-lg font-semibold text-foreground">Compare Scenarios</h1>
        <p className="text-sm text-muted-foreground">Compare the results of two different generator runs side-by-side.</p>
      </div>

      <div className="p-4 sm:p-6 max-w-[1600px] mx-auto w-full space-y-6">
        <div className="bg-card border p-4 sm:p-5 rounded-lg shadow-sm">
          <form onSubmit={handleSubmit} className="flex flex-col md:flex-row items-end gap-4">
            <div className="flex-1 w-full space-y-1">
              <Label>Left Run ID</Label>
              <Input required type="number" value={leftRunId} onChange={e => setLeftRunId(e.target.value)} placeholder="e.g. 12" />
            </div>
            <div className="hidden md:flex shrink-0 mb-2 px-2 text-muted-foreground">
              <ArrowRightLeft className="w-5 h-5" />
            </div>
            <div className="flex-1 w-full space-y-1">
              <Label>Right Run ID</Label>
              <Input required type="number" value={rightRunId} onChange={e => setRightRunId(e.target.value)} placeholder="e.g. 13" />
            </div>
            <Button type="submit" className="w-full md:w-auto shrink-0">Compare</Button>
          </form>

          {recentRuns.length > 0 && (
            <div className="mt-4 pt-4 border-t flex flex-wrap items-center gap-3 text-sm">
              <span className="text-muted-foreground">Recent:</span>
              {recentRuns.slice(0, 5).map(r => (
                <button
                  key={r.id}
                  type="button"
                  className="px-2 py-1 bg-muted rounded border hover:border-primary transition-colors text-xs"
                  onClick={() => {
                    if (!leftRunId) setLeftRunId(r.id.toString());
                    else if (!rightRunId) setRightRunId(r.id.toString());
                    else { setLeftRunId(r.id.toString()); setRightRunId(""); }
                  }}
                >
                  #{r.id} ({r.scenarioName || "Run"})
                </button>
              ))}
            </div>
          )}
        </div>

        {submittedIds && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Comparison Results</h2>
              <p className="text-xs text-muted-foreground">Only showing products with differing suggested prices.</p>
            </div>

            <div className="bg-card border rounded-lg overflow-hidden shadow-sm">
              <div className="grid grid-cols-[minmax(0,1fr)_160px_160px_100px] items-center gap-4 p-3 border-b bg-muted/40 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <div>Product</div>
                <div className="text-right">Left Run #{submittedIds.left}</div>
                <div className="text-right">Right Run #{submittedIds.right}</div>
                <div className="text-right">Variance</div>
              </div>

              <div className="divide-y max-h-[600px] overflow-y-auto">
                {isLoading ? (
                  <div className="p-4 space-y-3">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : error ? (
                  <div className="p-8 text-center text-destructive">Failed to load comparison data.</div>
                ) : differences.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">No differences found between these runs.</div>
                ) : (
                  differences.map((diffItem, idx: number) => {
                    const l = diffItem.left?.suggestedMrp;
                    const rt = diffItem.right?.suggestedMrp;
                    const diff = l != null && rt != null ? rt - l : 0;

                    return (
                      <div key={diffItem.itemCode || idx} className="grid grid-cols-[minmax(0,1fr)_160px_160px_100px] items-center gap-4 p-3 text-sm hover:bg-muted/10 transition-colors">
                        <div className="min-w-0">
                          <div className="font-medium text-foreground truncate">{diffItem.itemCode}</div>
                           <div className="text-xs text-muted-foreground truncate">{diffItem.left?.productName || diffItem.right?.productName || "No product name"}</div>
                        </div>
                        <div className="text-right">
                           {diffItem.left == null ? "Not in scope" : l != null ? `₹${l.toFixed(2)}` : diffItem.left.status}
                           {diffItem.left?.policyVersion === 2 && (
                             <div className="text-[10px] text-muted-foreground mt-1">
                               {diffItem.left.action} {diffItem.left.band && `• Bnd ${diffItem.left.band}`}
                               {diffItem.left.position && ` • ${diffItem.left.position}`}
                               {diffItem.left.escalation && ` • ESC`}
                             </div>
                           )}
                        </div>
                        <div className={cn("text-right font-medium", (rt !== l || diffItem.right?.action !== diffItem.left?.action || diffItem.right?.band !== diffItem.left?.band || diffItem.right?.escalation !== diffItem.left?.escalation) && "text-primary")}>
                           {diffItem.right == null ? "Not in scope" : rt != null ? `₹${rt.toFixed(2)}` : diffItem.right.status}
                           {diffItem.right?.policyVersion === 2 && (
                             <div className="text-[10px] text-muted-foreground mt-1">
                               {diffItem.right.action} {diffItem.right.band && `• Bnd ${diffItem.right.band}`}
                               {diffItem.right.position && ` • ${diffItem.right.position}`}
                               {diffItem.right.escalation && ` • ESC`}
                             </div>
                           )}
                        </div>
                        <div className={cn("text-right font-medium", diff > 0 ? "text-emerald-600" : diff < 0 ? "text-red-600" : "text-muted-foreground")}>
                          {diff !== 0 ? `${diff > 0 ? "+" : ""}₹${Math.abs(diff).toFixed(2)}` : "-"}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
