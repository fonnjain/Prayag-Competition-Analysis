import React, { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Plus, Play, Trash2, Edit, Activity, History, Zap, Info, ShieldAlert, Lock, Copy, RotateCcw, Target } from "lucide-react";
import {
  useListMrpGeneratorScenarios,
  useDeleteMrpGeneratorScenario,
  useCreateMrpGeneratorScenario,
  useUpdateMrpGeneratorScenario,
  useRunMrpGeneratorScenario,
  useDuplicateMrpGeneratorScenario,
  useResetMrpGeneratorScenario,
  useListMrpGeneratorRuns,
  useGetMrpGeneratorMetadata,
  useGetMrpGeneratorFreshness,
  usePreviewMrpGeneratorSimpleScenario,
  useComputeHistoricalMrp
} from "@workspace/api-client-react";
import { ScenarioDialog } from "./components/ScenarioDialog";
import { MrpGeneratorScope, MrpGeneratorRule, MrpGeneratorPolicy, MrpGeneratorSimplePolicy } from "./types";
import { useToast } from "@/hooks/use-toast";
import { formatDisplayDate } from "@/lib/date-format";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useGetMrpGeneratorScopes } from "@workspace/api-client-react";

function ScenarioPreviewSentence({ scenario }: { scenario: any }) {
  const previewMutation = usePreviewMrpGeneratorSimpleScenario();

  useEffect(() => {
    if (scenario.policyVersion === 3 && scenario.simplePolicy) {
      previewMutation.mutate({ data: { simplePolicy: scenario.simplePolicy, scope: scenario.scope } });
    }
  }, [scenario.id, scenario.updatedAt]); // Re-run if scenario updates

  if (scenario.policyVersion !== 3 || !scenario.simplePolicy) return null;

  if (previewMutation.isPending) {
    return <div className="text-sm text-muted-foreground animate-pulse mt-1">Calculating preview...</div>;
  }

  if (previewMutation.isError) {
    return <div className="text-sm text-destructive mt-1">Preview failed to load</div>;
  }

  if (previewMutation.isSuccess && previewMutation.data) {
    const summary = previewMutation.data.summary as any;
    return (
      <div className="text-sm text-muted-foreground mt-1">
        Would evaluate {summary?.total || 0} products; {summary?.suggested || 0} would change.
      </div>
    );
  }

  return null;
}

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
  const duplicateMutation = useDuplicateMrpGeneratorScenario();
  const resetMutation = useResetMrpGeneratorScenario();
  const computeHistoricalMutation = useComputeHistoricalMrp();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingScenario, setEditingScenario] = useState<any>(null);

  // Matching Setup Dialog State
  const [matchingDialogOpen, setMatchingDialogOpen] = useState(false);
  const [matchingDivision, setMatchingDivision] = useState<string>("");
  const [matchingCategory, setMatchingCategory] = useState<string>("");
  const [matchingCompetitors, setMatchingCompetitors] = useState<string[]>([]);
  const [matchingDriver, setMatchingDriver] = useState<string>("lowest");

  // Historical Setup Dialog State
  const [historicalDialogOpen, setHistoricalDialogOpen] = useState(false);
  const [historicalCategory, setHistoricalCategory] = useState<string>("");

  const { data: scopesData } = useGetMrpGeneratorScopes();

  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const isError403 = (err: any) => err && typeof err === 'object' && 'status' in err && err.status === 403;

  const getErrorMessage = (err: any) => {
    if (err && typeof err === 'object' && 'data' in err && err.data && typeof err.data === 'object' && 'error' in err.data) {
      return (err.data as any).error;
    }
    return err?.message || "Unknown error";
  };

  const availableCategories = React.useMemo(() => {
    if (!matchingDivision) return [];
    const pairs = (scopesData as any)?.categoryPairs as Array<{ division: string; category: string | null }> | undefined;
    if (pairs) {
      return pairs
        .filter(p => p.division === matchingDivision)
        .map(p => p.category);
    }
    return [];
  }, [scopesData, matchingDivision]);

  React.useEffect(() => {
    if (matchingDivision && matchingCategory && matchingCategory !== "all") {
      const isValid = availableCategories.some(c => (c === null ? "__uncategorised__" : c) === matchingCategory);
      if (!isValid) setMatchingCategory("");
    }
  }, [matchingDivision, availableCategories, matchingCategory]);

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

  const handleSave = (data: { name: string; description: string | null; scope: MrpGeneratorScope; rules?: MrpGeneratorRule[]; policyVersion?: 2 | 3; policy?: MrpGeneratorPolicy; simplePolicy?: MrpGeneratorSimplePolicy; advancedPolicy?: any }) => {
    if (editingScenario?.id) {
      updateMutation.mutate({ scenarioId: editingScenario.id, data: { ...data, rules: data.rules as any, scope: data.scope as any } as any }, {
        onSuccess: () => {
          setDialogOpen(false);
          refetchScenarios();
        },
        onError: (err: any) => toast({ title: "Update Failed", description: getErrorMessage(err), variant: "destructive" })
      });
    } else {
      createMutation.mutate({ data: { ...data, rules: data.rules as any, scope: data.scope as any, advancedPolicy: data.advancedPolicy as any } }, {
        onSuccess: () => {
          setDialogOpen(false);
          refetchScenarios();
        },
        onError: (err: any) => toast({ title: "Create Failed", description: getErrorMessage(err), variant: "destructive" })
      });
    }
  };

  const handleDuplicate = (id: number) => {
    duplicateMutation.mutate({ scenarioId: id, data: {} }, {
      onSuccess: () => {
        toast({ title: "Scenario duplicated" });
        refetchScenarios();
      },
      onError: (err: any) => toast({ title: "Duplicate Failed", description: getErrorMessage(err), variant: "destructive" })
    });
  };

  const handleReset = (id: number) => {
    if (!confirm("Are you sure you want to reset this scenario to its default state? All custom changes will be lost.")) return;
    resetMutation.mutate({ scenarioId: id }, {
      onSuccess: () => {
        toast({ title: "Scenario reset to default" });
        refetchScenarios();
      },
      onError: (err: any) => toast({ title: "Reset Failed", description: getErrorMessage(err), variant: "destructive" })
    });
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
          <Button variant="outline" onClick={() => setMatchingDialogOpen(true)}>
            <Target className="w-4 h-4 mr-2" />
            Matching MRP
          </Button>
          <Button variant="outline" onClick={() => setHistoricalDialogOpen(true)}>
            <History className="w-4 h-4 mr-2" />
            Compute Historical
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
                  <div className="flex items-start gap-1.5 mt-2 text-emerald-700 bg-emerald-50 p-1.5 rounded border border-emerald-200">
                    <Zap className="w-4 h-4 shrink-0" />
                    <span>Competitive-only pricing engine is available.</span>
                  </div>

                  {metadata.salesApi?.components?.sales && (
                    <div className={`flex items-start gap-1.5 mt-2 p-1.5 rounded border ${metadata.salesApi.components.sales.available ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : metadata.salesApi.components.sales.status === 'rate_limited' ? 'text-orange-700 bg-orange-50 border-orange-200' : 'text-amber-700 bg-amber-50 border-amber-200'}`}>
                      <Zap className="w-4 h-4 shrink-0" />
                      <div className="flex flex-col">
                        <span>Sales API (Volume): {metadata.salesApi.components.sales.available ? 'Available' : metadata.salesApi.components.sales.status === 'rate_limited' ? 'RATE LIMITED' : 'Unavailable'}</span>
                        <span className="text-xs mt-0.5">Page size: {metadata.salesApi.components.sales.pageSize ?? 500} · Requests per refresh: {metadata.salesApi.components.sales.requestsMade ?? metadata.salesApi.components.sales.requestMetrics?.requestsMade ?? "latest refresh pending"}</span>
                        {!metadata.salesApi.components.sales.available && metadata.salesApi.components.sales.reason && (
                          <span className="text-xs mt-0.5">{metadata.salesApi.components.sales.reason}</span>
                        )}
                        {metadata.salesApi.components.sales.status === 'rate_limited' && metadata.salesApi.components.sales.retryAt && (
                          <span className="text-xs mt-0.5">Retry after: {new Date(metadata.salesApi.components.sales.retryAt).toLocaleString()}</span>
                        )}
                        {!metadata.salesApi.components.sales.available && metadata.salesApi.components.sales.upstreamStatus && (
                          <span className="text-xs mt-0.5">Upstream Status: {metadata.salesApi.components.sales.upstreamStatus}</span>
                        )}
                      </div>
                    </div>
                  )}

                  {metadata.salesApi?.components?.margin && (
                    <div className={`flex items-start gap-1.5 mt-2 p-1.5 rounded border ${metadata.salesApi.components.margin.available ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : metadata.salesApi.components.margin.status === 'rate_limited' ? 'text-orange-700 bg-orange-50 border-orange-200' : 'text-amber-700 bg-amber-50 border-amber-200'}`}>
                      <Zap className="w-4 h-4 shrink-0" />
                      <div className="flex flex-col">
                        <span>Margin API: {metadata.salesApi.components.margin.available ? 'Available' : metadata.salesApi.components.margin.status === 'rate_limited' ? 'RATE LIMITED' : 'Unavailable'}</span>
                        <span className="text-xs mt-0.5">Page size: {metadata.salesApi.components.margin.pageSize ?? 500} · Requests per refresh: {metadata.salesApi.components.margin.requestsMade ?? metadata.salesApi.components.margin.requestMetrics?.requestsMade ?? "latest refresh pending"}</span>
                        {!metadata.salesApi.components.margin.available && metadata.salesApi.components.margin.reason && (
                          <span className="text-xs mt-0.5">{metadata.salesApi.components.margin.reason}</span>
                        )}
                        {metadata.salesApi.components.margin.status === 'rate_limited' && metadata.salesApi.components.margin.retryAt && (
                          <span className="text-xs mt-0.5">Retry after: {new Date(metadata.salesApi.components.margin.retryAt).toLocaleString()}</span>
                        )}
                        {!metadata.salesApi.components.margin.available && metadata.salesApi.components.margin.upstreamStatus && (
                          <span className="text-xs mt-0.5">Upstream Status: {metadata.salesApi.components.margin.upstreamStatus}</span>
                        )}
                      </div>
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
                    <ScenarioPreviewSentence scenario={s} />
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      {s.policyVersion === 2 && s.advancedPolicy ? (
                        <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                          Promoted Advanced ({s.advancedPolicy.simpleRows?.length || 0} base rules)
                        </span>
                      ) : s.policyVersion === 2 ? (
                        <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                          Native P011: {s.policy?.competitor?.mode === 'named' ? s.policy.competitor.named : s.policy?.competitor?.mode} | {s.policy?.portfolio?.mode === 'improve_by_points' ? `+${s.policy.portfolio.points} pts` : s.policy?.portfolio?.mode === 'allow_decline_points' ? `-${s.policy.portfolio.points} pts` : 'Hold margin'}
                        </span>
                      ) : s.policyVersion === 3 ? (
                        <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                          Simple ({s.simplePolicy?.rows?.length || 0} rules){!s.simplePolicy?.marginEnabled ? ' · Margin Off' : ''}{!s.simplePolicy?.volumeEnabled ? ' · Volume Off' : ''}
                        </span>
                      ) : s.rules?.length ? (
                        <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">Legacy ({s.rules.length} Rules)</span>
                      ) : null}
                      <span className="text-muted-foreground/80">Updated {formatDisplayDate(s.updatedAt)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="secondary" size="sm" onClick={() => handleRun(s.id, s.name)} disabled={runMutation.isPending}>
                      <Play className="w-4 h-4 mr-2" /> Run
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => { setEditingScenario(s); setDialogOpen(true); }} title="Edit">
                      <Edit className="w-4 h-4 text-muted-foreground" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDuplicate(s.id)} title="Duplicate">
                      <Copy className="w-4 h-4 text-muted-foreground" />
                    </Button>
                    {s.canReset && (
                      <Button variant="ghost" size="icon" onClick={() => handleReset(s.id)} title="Reset to default">
                        <RotateCcw className="w-4 h-4 text-muted-foreground" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(s.id)} title="Delete">
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
                    <div className="text-sm font-medium group-hover:text-primary transition-colors truncate">
                      {r.scenarioName || ((r as any).runType === "matching" ? `Matching Session #${r.id}` : (r as any).runType === "historical" ? `Historical Run #${r.id}` : `Run #${r.id}`)}
                    </div>
                    <div className="text-xs text-muted-foreground flex justify-between mt-1">
                      <span className="capitalize">{(r as any).runType || "Rule"} Run</span>
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

      <Dialog open={historicalDialogOpen} onOpenChange={setHistoricalDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Compute Historical MRP</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">Compute historical MRP baseline based on current catalog patterns.</p>
            <div className="space-y-2">
              <Label>Category (Optional)</Label>
              <Select value={historicalCategory || "all"} onValueChange={(v) => setHistoricalCategory(v === "all" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {scopesData?.categories?.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">Exact catalogue category; compound divisions stay one stored compound value and products appear once.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoricalDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                computeHistoricalMutation.mutate({
                  data: { category: historicalCategory || undefined }
                }, {
                  onSuccess: (res) => {
                    refetchRuns();
                    setHistoricalDialogOpen(false);
                    setLocation(`/mrp-generator/runs/${res.runId}`);
                  },
                  onError: (err: any) => toast({ title: "Historical Run Failed", description: getErrorMessage(err), variant: "destructive" })
                });
              }}
              disabled={computeHistoricalMutation.isPending}
            >
              {computeHistoricalMutation.isPending ? "Computing..." : "Compute Baseline"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={matchingDialogOpen} onOpenChange={setMatchingDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Matching MRP Workbench</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">Select a scope and competitors to begin matching.</p>

            <div className="space-y-2">
              <Label>Division (Required)</Label>
              <Select value={matchingDivision} onValueChange={(v) => { setMatchingDivision(v); setMatchingCategory(""); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a division" />
                </SelectTrigger>
                <SelectContent>
                  {scopesData?.divisions?.map((d) => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Category (Optional)</Label>
              <Select value={matchingCategory} onValueChange={setMatchingCategory} disabled={!matchingDivision || availableCategories.length === 0}>
                <SelectTrigger>
                  <SelectValue placeholder="All categories in division" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">-- All Categories --</SelectItem>
                  {availableCategories.map((c, i) => {
                    const val = c === null ? "__uncategorised__" : c;
                    const label = c === null ? "Uncategorised" : c;
                    return <SelectItem key={val || i} value={val}>{label}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">
                Warning: Exact category matching is strict. To match a compound like "CP Fittings / Faucets", you must use the Division dropdown instead.
              </p>
            </div>

            <div className="space-y-2 pt-2">
              <Label>Competitors (Select at least one)</Label>
              <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto p-2 border rounded-md bg-muted/20">
                {scopesData?.competitors?.map((c) => (
                  <label key={c} className="flex items-center space-x-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={matchingCompetitors.includes(c)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setMatchingCompetitors(prev => [...prev, c]);
                        } else {
                          setMatchingCompetitors(prev => prev.filter(x => x !== c));
                        }
                      }}
                    />
                    <span className="truncate" title={c}>{c}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <Label>Global Target Driver</Label>
              <Select value={matchingDriver} onValueChange={setMatchingDriver}>
                <SelectTrigger>
                  <SelectValue placeholder="Select target driver" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lowest">Lowest Price</SelectItem>
                  <SelectItem value="highest">Highest Price</SelectItem>
                  {matchingCompetitors.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMatchingDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                const params = new URLSearchParams();
                params.set("division", matchingDivision);
                if (matchingCategory && matchingCategory !== "all") {
                  params.set("category", matchingCategory);
                }
                matchingCompetitors.forEach(c => params.append("competitors", c));
                params.set("driver", matchingDriver);
                setLocation(`/mrp-generator/matching?${params.toString()}`);
                setMatchingDialogOpen(false);
              }}
              disabled={!matchingDivision || matchingCompetitors.length === 0}
            >
              Open Workbench
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
