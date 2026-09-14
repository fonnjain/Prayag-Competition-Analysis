import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Plus, Play, Trash2, Edit, Activity, History, Zap, Info, ShieldAlert, Lock } from "lucide-react";
import {
  useListMrpGeneratorScenarios,
  useDeleteMrpGeneratorScenario,
  useCreateMrpGeneratorScenario,
  useUpdateMrpGeneratorScenario,
  useRunMrpGeneratorScenario,
  useListMrpGeneratorRuns,
  useGetMrpGeneratorMetadata,
  useGetMrpGeneratorFreshness
} from "@workspace/api-client-react";
import { ScenarioDialog } from "./components/ScenarioDialog";
import { MrpGeneratorScope, MrpGeneratorRule, MrpGeneratorPolicy } from "./types";
import { useToast } from "@/hooks/use-toast";
import { formatDisplayDate } from "@/lib/date-format";

export default function MrpGeneratorList() {
  const { data: scenarios, refetch: refetchScenarios, error: scenariosError } = useListMrpGeneratorScenarios();
  const { data: runsData, refetch: refetchRuns, error: runsError } = useListMrpGeneratorRuns({ limit: 10 });
  const { data: metadata, error: metadataError } = useGetMrpGeneratorMetadata();
  const { data: freshness, error: freshnessError } = useGetMrpGeneratorFreshness();

  const recentRuns = runsData?.runs || [];

  const deleteMutation = useDeleteMrpGeneratorScenario();
  const createMutation = useCreateMrpGeneratorScenario();
  const updateMutation = useUpdateMrpGeneratorScenario();
  const runMutation = useRunMrpGeneratorScenario();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingScenario, setEditingScenario] = useState<any>(null);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const isError403 = (err: any) => err && typeof err === 'object' && 'status' in err && err.status === 403;

  const getErrorMessage = (err: any) => {
    if (err && typeof err === 'object' && 'data' in err && err.data && typeof err.data === 'object' && 'error' in err.data) {
      return (err.data as any).error;
    }
    return err?.message || "Unknown error";
  };

  const isForbidden = [scenariosError, runsError, metadataError, freshnessError].some(isError403);

  if (isForbidden) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center space-y-4">
        <div className="w-12 h-12 bg-destructive/10 rounded-full flex items-center justify-center">
          <Lock className="w-6 h-6 text-destructive" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">Access Denied</h2>
          <p className="text-muted-foreground mt-1 max-w-md mx-auto">
            You do not have permission to access the MRP Generator. This feature is restricted to senior commercial administrators.
          </p>
        </div>
      </div>
    );
  }

  const handleDelete = (id: number) => {
    if (!confirm("Delete this scenario?")) return;
    deleteMutation.mutate({ scenarioId: id }, {
      onSuccess: () => refetchScenarios(),
      onError: (err: any) => toast({ title: "Delete Failed", description: getErrorMessage(err), variant: "destructive" })
    });
  };

  const handleSave = (data: { name: string; description: string | null; scope: MrpGeneratorScope; rules?: MrpGeneratorRule[]; policyVersion?: 2; policy?: MrpGeneratorPolicy }) => {
    if (editingScenario?.id) {
      updateMutation.mutate({ scenarioId: editingScenario.id, data: { ...data, rules: data.rules as any, scope: data.scope as any } }, {
        onSuccess: () => {
          setDialogOpen(false);
          refetchScenarios();
        },
        onError: (err: any) => toast({ title: "Update Failed", description: getErrorMessage(err), variant: "destructive" })
      });
    } else {
      createMutation.mutate({ data: { ...data, rules: data.rules as any, scope: data.scope as any } }, {
        onSuccess: () => {
          setDialogOpen(false);
          refetchScenarios();
        },
        onError: (err: any) => toast({ title: "Create Failed", description: getErrorMessage(err), variant: "destructive" })
      });
    }
  };

  const handleRun = (id: number, name: string) => {
    if (!confirm(`Run scenario "${name}" now?`)) return;
    runMutation.mutate({ scenarioId: id, data: {} }, {
      onSuccess: (run) => {
        refetchRuns();
        setLocation(`/mrp-generator/runs/${run.runId}`);
      },
      onError: (err: any) => toast({ title: "Run Failed", description: getErrorMessage(err), variant: "destructive" })
    });
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="flex flex-col min-h-full bg-muted/20">
      <div className="border-b bg-card px-4 py-3 sm:px-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">MRP Generator</h1>
          <p className="text-sm text-muted-foreground">Define deterministic pricing scenarios based on competitor matching rules.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/mrp-generator/compare">
              <Activity className="w-4 h-4 mr-2" />
              Compare Runs
            </Link>
          </Button>
          <Button onClick={() => { setEditingScenario(null); setDialogOpen(true); }}>
            <Plus className="w-4 h-4 mr-2" />
            New Scenario
          </Button>
        </div>
      </div>

      <div className="flex-1 p-4 sm:p-6 max-w-[1600px] mx-auto w-full grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {metadata && freshness && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div className="bg-card border rounded-lg p-4 shadow-sm text-sm space-y-2">
                <h3 className="font-semibold text-foreground flex items-center gap-2 border-b pb-1">
                  <Zap className="w-4 h-4" /> Capabilities
                </h3>
                <div className="flex flex-col gap-1 text-muted-foreground">
                  <div>Stage: <strong className="text-foreground">{metadata.stage}</strong></div>
                  <div>Mode: <strong className="text-foreground">{metadata.deterministic ? "Deterministic" : "Stochastic"}</strong></div>
                  {metadata.salesApi?.status === "missing_credential" && (
                    <div className="flex items-start gap-1.5 mt-2 text-amber-700 bg-amber-50 p-1.5 rounded border border-amber-200">
                      <ShieldAlert className="w-4 h-4 shrink-0" />
                      <span>SALES_API_KEY is not configured and rules are unavailable.</span>
                    </div>
                  )}
                  {metadata.salesApi?.status === "auth_failed" && (
                    <div className="flex items-start gap-1.5 mt-2 text-destructive bg-destructive/10 p-1.5 rounded border border-destructive/20">
                      <ShieldAlert className="w-4 h-4 shrink-0" />
                      <span>Sales API authentication failed and rules are unavailable.</span>
                    </div>
                  )}
                  {metadata.salesApi?.status === "unavailable" && (
                    <div className="flex items-start gap-1.5 mt-2 text-amber-700 bg-amber-50 p-1.5 rounded border border-amber-200">
                      <ShieldAlert className="w-4 h-4 shrink-0" />
                      <span>Sales API is currently unavailable upstream. Rules are unavailable.</span>
                    </div>
                  )}
                  {metadata.salesApi?.status === "authenticated" && (
                    <div className="flex items-start gap-1.5 mt-2 text-emerald-700 bg-emerald-50 p-1.5 rounded border border-emerald-200">
                      <Zap className="w-4 h-4 shrink-0" />
                      <span>Sales API authenticated. Advanced rules available.</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-card border rounded-lg p-4 shadow-sm text-sm space-y-2">
                <h3 className="font-semibold text-foreground flex items-center gap-2 border-b pb-1">
                  <History className="w-4 h-4" /> Data Freshness
                </h3>
                <div className="flex flex-col gap-1 text-muted-foreground">
                  <div className="flex justify-between">
                    <span>As of:</span>
                    <strong className="text-foreground">{formatDisplayDate(freshness.asOf)}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Prayag MRP:</span>
                    <strong className="text-foreground">{freshness.mrp?.effectiveDate ? formatDisplayDate(freshness.mrp.effectiveDate) : "-"}</strong>
                  </div>
                  <div className="flex justify-between border-t pt-1 mt-1">
                    <span className="text-xs font-semibold uppercase">Competitors</span>
                    <span className="text-xs">{freshness.competitors?.length || 0} mapped</span>
                  </div>
                  {freshness.competitors?.slice(0, 3).map(c => (
                    <div key={c.competitor} className="flex justify-between text-xs">
                      <span>{c.competitor}:</span>
                      <span className={c.stale ? "text-amber-600 font-medium" : ""}>
                        {c.effectiveDate ? formatDisplayDate(c.effectiveDate) : "-"} {c.stale && `(${c.ageDays}d old)`}
                      </span>
                    </div>
                  ))}
                  {(freshness.competitors?.length || 0) > 3 && (
                    <div className="text-xs text-center text-muted-foreground pt-1">+ {(freshness.competitors?.length || 0) - 3} more</div>
                  )}
                </div>
              </div>
            </div>
          )}

          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">Saved Scenarios</h2>
          {(!scenarios || scenarios.length === 0) ? (
            <div className="bg-card border border-dashed p-10 text-center rounded-xl text-muted-foreground">
              No scenarios found. Create one to begin.
            </div>
          ) : (
            <div className="grid gap-3">
              {scenarios.map((s) => (
                <div key={s.id} className="bg-card border rounded-lg p-4 shadow-sm flex flex-col sm:flex-row gap-4 sm:items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-base text-foreground truncate">{s.name}</h3>
                    {s.description && <p className="text-sm text-muted-foreground truncate">{s.description}</p>}
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      {s.policyVersion === 2 ? (
                        <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                          P011 Policy: {s.policy?.competitor?.mode === 'named' ? s.policy.competitor.named : s.policy?.competitor?.mode} | {s.policy?.portfolio?.mode === 'improve_by_points' ? `+${s.policy.portfolio.points} pts` : s.policy?.portfolio?.mode === 'allow_decline_points' ? `-${s.policy.portfolio.points} pts` : 'Hold margin'}
                        </span>
                      ) : s.rules?.length ? (
                        <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">{s.rules.length} Rules</span>
                      ) : null}
                      <span className="text-muted-foreground/80">Updated {formatDisplayDate(s.updatedAt)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="secondary" size="sm" onClick={() => handleRun(s.id, s.name)} disabled={runMutation.isPending}>
                      <Play className="w-4 h-4 mr-2" /> Run
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => { setEditingScenario(s); setDialogOpen(true); }}>
                      <Edit className="w-4 h-4 text-muted-foreground" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(s.id)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-1 border-l pl-0 lg:pl-6 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2">
            <History className="w-4 h-4" /> Recent Runs
          </h2>
          {recentRuns.length === 0 ? (
            <div className="text-sm text-muted-foreground">No recent runs available.</div>
          ) : (
            <div className="space-y-2">
              {recentRuns.map((r) => (
                <Link key={r.id} href={`/mrp-generator/runs/${r.id}`}>
                  <div className="p-3 border bg-card rounded-md hover:border-primary transition-colors cursor-pointer group">
                    <div className="text-sm font-medium group-hover:text-primary transition-colors truncate">{r.scenarioName || `Run #${r.id}`}</div>
                    <div className="text-xs text-muted-foreground flex justify-between mt-1">
                      <span>Run #{r.id}</span>
                      <span>{new Date(r.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <ScenarioDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialData={editingScenario}
        onSave={handleSave}
        isSaving={isSaving}
      />
    </div>
  );
}
