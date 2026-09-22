import { formatMoney } from "@workspace/formatting";
import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Trash2, ArrowUp, ArrowDown, Info } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MrpGeneratorScope, MrpGeneratorRule, ALL_RULE_TYPES, MrpGeneratorPolicy, MrpGeneratorSimplePolicy, MrpGeneratorSimpleRule, MrpGeneratorSimpleCompetitorMode, MrpGeneratorSimpleRuleAppliesToType, MrpGeneratorSimpleRuleTargetMode, MrpGeneratorSimplePolicyRoundingDirection, MrpGeneratorAdvancedPolicy } from "../types";
import { useGetMrpGeneratorScopes, useGetMrpGeneratorMetadata, usePromoteMrpGeneratorSimpleScenario, useDemoteMrpGeneratorAdvancedScenario } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { usePreviewMrpGeneratorSimpleScenario } from "@workspace/api-client-react";

const DEFAULT_POLICY: MrpGeneratorPolicy = {
  policyVersion: 2,
  period: "2026-27",
  bands: { A: 0.5, B: 0.8, C: 0.95, D: 0.99 },
  competitor: { mode: "nearest", named: null, staleAfterDays: 365, excludeStale: true },
  position: { wellBelowAbove: 0.08, parityBelow: -0.03, parityAbove: 0.08 },
  captureShares: { A: 0.30, B: 0.40, C: 0.50, D: 0.60, E: 0.70 },
  defendTargetUndercut: 0.02,
  categoryFloors: { PTMT: 65, "C P": 38, PLUMBING: 30, SANITARYWARE: 38, SINK: 40, HARDWARE: 38 },
  marginTargetUpliftPoints: 2,
  maxIncreasePercent: 15,
  maxDecreasePercent: 5,
  holdThreshold: 50,
  rounding: { unit: 1, direction: "nearest" },
  portfolio: { mode: "hold_current", points: 0 }
};

const DEFAULT_SIMPLE_POLICY: MrpGeneratorSimplePolicy = {
  policyVersion: 3,
  mode: 'simple',
  holdBelow: 50,
  rounding: { unit: 1, direction: 'nearest' },
  marginEnabled: false,
  volumeEnabled: false,
  rows: []
};

interface ScenarioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialData?: {
    id?: number;
    name: string;
    description: string | null;
    scope: MrpGeneratorScope;
    rules: MrpGeneratorRule[];
    policyVersion?: number | null;
    policy?: MrpGeneratorPolicy | null;
    simplePolicy?: MrpGeneratorSimplePolicy;
    advancedPolicy?: MrpGeneratorAdvancedPolicy;
  };
  onSave: (data: { name: string; description: string | null; scope: MrpGeneratorScope; rules?: MrpGeneratorRule[]; policyVersion?: 2 | 3; policy?: MrpGeneratorPolicy; simplePolicy?: MrpGeneratorSimplePolicy; advancedPolicy?: MrpGeneratorAdvancedPolicy }) => void;
  isSaving: boolean;
  error?: string | null;
}

export function ScenarioDialog({ open, onOpenChange, initialData, onSave, isSaving, error }: ScenarioDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<MrpGeneratorScope>({});
  const [rules, setRules] = useState<MrpGeneratorRule[]>([]);
  const [policyVersion, setPolicyVersion] = useState<2 | 3>(3);
  const [policy, setPolicy] = useState<MrpGeneratorPolicy>(DEFAULT_POLICY);
  const [simplePolicy, setSimplePolicy] = useState<MrpGeneratorSimplePolicy>(DEFAULT_SIMPLE_POLICY);
  const [advancedPolicy, setAdvancedPolicy] = useState<MrpGeneratorAdvancedPolicy | null>(null);
  const [isNativeP011, setIsNativeP011] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  const promoteMutation = usePromoteMrpGeneratorSimpleScenario();
  const demoteMutation = useDemoteMrpGeneratorAdvancedScenario();
  const previewMutation = usePreviewMrpGeneratorSimpleScenario();
  const { toast } = useToast();

  const [previewData, setPreviewData] = useState<any>(null);
  const previewSequenceRef = React.useRef(0);

  useEffect(() => {
    if (!open || policyVersion !== 3) return;

    // Immediately increment sequence and clear preview on any change
    const seq = ++previewSequenceRef.current;
    setPreviewData(null);

    const timeout = setTimeout(() => {
      const isValid = simplePolicy.rows.every(r => {
        if (r.competitor.mode === "named" && !r.competitor.name?.trim()) return false;
        if (r.appliesTo.type === "explicit_codes" && (!r.appliesTo.value || !r.appliesTo.value.length)) return false;
        if (r.target.mode !== "match" && (r.target.percent === null || r.target.percent === undefined || r.target.percent < 0)) return false;
        return true;
      });

      if (!isValid) return; // keeps preview cleared if invalid

      previewMutation.mutate({ data: { simplePolicy, scope } }, {
        onSuccess: (data) => {
          if (seq === previewSequenceRef.current) setPreviewData(data);
        },
        onError: () => {
          if (seq === previewSequenceRef.current) setPreviewData(null);
        }
      });
    }, 750);
    return () => clearTimeout(timeout);
  }, [simplePolicy, scope, policyVersion, open]);

  const { data: scopesData } = useGetMrpGeneratorScopes();
  const { data: metadata } = useGetMrpGeneratorMetadata();
  const disabledRules = new Set<string>([
    ...(metadata?.disabledRules ?? []).map((rule) => rule.type),
  ]);

  useEffect(() => {
    if (open) {
      setName(initialData?.name || "");
      setDescription(initialData?.description || "");
      setScope(initialData?.scope || {});
      setRules(initialData?.rules || []);

      const v = initialData?.policyVersion;
      setPolicyVersion(v === 2 ? 2 : 3);

      const hasAdvanced = !!initialData?.advancedPolicy;
      setAdvancedPolicy(initialData?.advancedPolicy || null);

      // Native P011 is when it's version 2 but no advancedPolicy (promoted) is present
      setIsNativeP011(v === 2 && !hasAdvanced);

      if (initialData?.policy) {
        setPolicy(initialData.policy);
      } else {
        setPolicy(DEFAULT_POLICY);
      }

      if (initialData?.simplePolicy) {
        setSimplePolicy(initialData.simplePolicy);
      } else {
        setSimplePolicy(DEFAULT_SIMPLE_POLICY);
      }

      setFormError(null);
    }
  }, [open, initialData, metadata?.salesApi?.status]);

  const handleTabChange = async (val: string) => {
    const targetVersion = val === "simple" ? 3 : 2;
    if (targetVersion === policyVersion) return;

    // If we are native P011, we shouldn't really be demoting to Simple or maybe we should?
    // "If user chooses a native P011 scenario, retain existing full P011 editor. Advanced->Simple sends current advancedPolicy to demotion endpoint without mutating"

    if (targetVersion === 2) {
      // Promote Simple -> Advanced
      // "Promotion must send CURRENT unsaved simplePolicy + current name/description/scope to non-mutating promotion endpoint."
      promoteMutation.mutate({
        scenarioId: initialData?.id || 0,
        data: { simplePolicy }
      }, {
        onSuccess: (res) => {
          setAdvancedPolicy(res.advanced);
          setIsNativeP011(false);
          setPolicyVersion(2);
          toast({ title: "Scenario Promoted to Advanced", description: "Your rules have been converted to policy bounds." });
        },
        onError: (err: any) => {
          const msg = err?.data?.error || err?.message || "Failed to promote scenario";
          toast({ title: "Promotion Failed", description: msg, variant: "destructive" });
        }
      });
    } else {
      // Demote Advanced -> Simple
      // "Advanced->Simple sends current advancedPolicy to demotion endpoint without mutating"
      demoteMutation.mutate({
        scenarioId: initialData?.id || 0,
        data: advancedPolicy ? { advancedPolicy } : undefined
      }, {
        onSuccess: (res) => {
          if (res?.simplePolicy) {
            setSimplePolicy(res.simplePolicy);
          }
          setPolicyVersion(3);
          toast({ title: "Scenario Demoted to Simple", description: "Policy bounds converted to rules." });
        },
        onError: (err: any) => {
          const msg = err?.data?.error || err?.message || "Failed to demote scenario";
          toast({ title: "Cannot convert to Simple", description: msg, variant: "destructive" });
        }
      });
    }
  };

  const validationError = (() => {
    if (!name.trim()) return "Enter a scenario name.";

    if (policyVersion === 2) {
      if (!isNativeP011 && !advancedPolicy) {
        return "Advanced policy is not loaded.";
      }
      if (isNativeP011) {
        if (policy.competitor?.mode === "named" && !policy.competitor.named) {
          return "You must select a named competitor.";
        }
        if (
          (policy.position?.wellBelowAbove ?? 0) < (policy.position?.parityAbove ?? 0) ||
          (policy.position?.wellBelowAbove ?? 0) < Math.abs(policy.position?.parityBelow ?? 0)
        ) {
          return "Position thresholds are invalid: well below/above must be greater than or equal to parity buffers.";
        }
        const b = policy.bands || { A: 0, B: 0, C: 0, D: 0 };
        const [bA, bB, bC, bD] = [b.A ?? 0, b.B ?? 0, b.C ?? 0, b.D ?? 0];
        if (bA >= bB || bB >= bC || bC >= bD) {
          return "Band boundaries must be strictly ascending.";
        }
        if (
          Object.values(policy.captureShares || {}).some(v => v < 0 || v > 1) ||
          (policy.defendTargetUndercut !== undefined && (policy.defendTargetUndercut < 0 || policy.defendTargetUndercut > 1))
        ) {
          return "Fractions like capture shares and defend undercut must be between 0 and 1.";
        }
        const requiredCats = ['PTMT', 'C P', 'PLUMBING', 'SANITARYWARE', 'SINK', 'HARDWARE'];
        const floors = policy.categoryFloors as Record<string, number> | undefined;
        if (!floors || requiredCats.some(c => floors[c] === undefined || floors[c] < 0 || floors[c] >= 100)) {
          return "All category floors must be provided and stay below 100%.";
        }
        if (requiredCats.some(c => floors[c] + (policy.marginTargetUpliftPoints ?? 0) >= 100)) {
          return "Each category floor plus the margin-only uplift must stay below 100%.";
        }
        if ((policy.marginTargetUpliftPoints ?? 0) < 0 || (policy.maxIncreasePercent ?? 0) < 0 || (policy.maxDecreasePercent ?? 0) < 0) {
          return "Points and limit thresholds cannot be negative.";
        }
      }
    } else if (policyVersion === 3) {
      if (simplePolicy.holdBelow < 0) return "Hold threshold must be zero or greater.";
      if (!simplePolicy.rows.length) return "Add at least one rule.";
      if (!simplePolicy.rows.some(r => r.catchAll)) {
        // Warning, not error
      }
      for (const row of simplePolicy.rows) {
        if (row.competitor.mode === "named" && !row.competitor.name?.trim()) {
          return `Row ${row.order}: Choose a named competitor.`;
        }
        if (row.appliesTo.type === "explicit_codes" && (!row.appliesTo.value || !row.appliesTo.value.length)) {
          return `Row ${row.order}: Enter at least one item code.`;
        }
        if (row.target.mode !== "match" && (row.target.percent === null || row.target.percent === undefined || row.target.percent < 0)) {
          return `Row ${row.order}: Target percentage must be 0 or greater.`;
        }
      }
    } else {
      const activeRules = rules.filter((rule) => !disabledRules.has(rule.type));
      if (!activeRules.length) return "Add at least one available rule.";
      for (const rule of activeRules) {
        if ((rule.type === "percent_below" || rule.type === "match") && !rule.competitor.trim()) {
          return "Choose a named competitor for every competitor-specific rule.";
        }
        if ("percent" in rule && (!Number.isFinite(rule.percent) || rule.percent < 0)) {
          return "Rule percentages must be zero or greater.";
        }
        if (rule.type === "hold_below" && (!Number.isFinite(rule.threshold) || rule.threshold < 0)) {
          return "The hold threshold must be zero or greater.";
        }
      }
    }
    return null;
  })();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validationError) {
      setFormError(validationError);
      return;
    }
    const explicitCodes = [...new Set(
      (scope.explicitCodes ?? []).map((code) => code.trim()).filter(Boolean),
    )];

    const finalScope = { ...scope, explicitCodes: explicitCodes.length ? explicitCodes : undefined };

    if (policyVersion === 2) {
      if (!isNativeP011 && advancedPolicy) {
        onSave({
          name: name.trim(),
          description: description.trim() || null,
          scope: finalScope,
          policyVersion: 2,
          advancedPolicy
        });
      } else {
        onSave({
          name: name.trim(),
          description: description.trim() || null,
          scope: finalScope,
          policyVersion: 2,
          policy: policy || DEFAULT_POLICY
        });
      }
    } else if (policyVersion === 3) {
      onSave({
        name: name.trim(),
        description: description.trim() || null,
        scope: finalScope,
        policyVersion: 3,
        simplePolicy: simplePolicy
      });
    } else {
      onSave({
        name: name.trim(),
        description: description.trim() || null,
        scope: finalScope,
        rules: rules.filter((rule) => !disabledRules.has(rule.type))
      });
    }
  };

  const addRule = (type: MrpGeneratorRule["type"]) => {
    const baseRule = { type } as any;
    if (type === "percent_below") Object.assign(baseRule, { competitor: "", percent: 5 });
    if (type === "match") Object.assign(baseRule, { competitor: "" });
    if (type === "percent_above_lowest") Object.assign(baseRule, { percent: 5 });
    if (type === "max_increase") Object.assign(baseRule, { percent: 10 });
    if (type === "max_decrease") Object.assign(baseRule, { percent: 10 });
    if (type === "hold_below") Object.assign(baseRule, { threshold: 1000 });
    if (type === "rounding") Object.assign(baseRule, { unit: 10, direction: "nearest" });
    if (type === "margin_floor") Object.assign(baseRule, { categoryFloors: { PTMT: 65, "C P": 38, PLUMBING: 30, SANITARYWARE: 38, SINK: 40, HARDWARE: 38 } });
    if (type === "volume_tier") Object.assign(baseRule, { period: "2026-27", mode: "cumulative_contribution", tier: "A", cumulativeValuePercent: 80 });
    setRules([...rules, baseRule]);
  };

  const updateRule = (index: number, updates: Partial<MrpGeneratorRule>) => {
    const newRules = [...rules];
    newRules[index] = { ...newRules[index], ...updates } as MrpGeneratorRule;
    setRules(newRules);
  };

  const moveRule = (index: number, direction: -1 | 1) => {
    if (index + direction < 0 || index + direction >= rules.length) return;
    const newRules = [...rules];
    const temp = newRules[index];
    newRules[index] = newRules[index + direction];
    newRules[index + direction] = temp;
    setRules(newRules);
  };

  const removeRule = (index: number) => {
    setRules(rules.filter((_, i) => i !== index));
  };

  const marginComponent = metadata?.salesApi?.components?.margin;
  const volumeComponent = metadata?.salesApi?.components?.sales;
  const noMargin = marginComponent ? !marginComponent.available : (metadata?.salesApi?.status !== "authenticated");
  const noVolume = volumeComponent ? !volumeComponent.available : (metadata?.salesApi?.status !== "authenticated");
  const marginReason = marginComponent?.reason || metadata?.salesApi?.reason || "Sales API unavailable.";
  const volumeReason = volumeComponent?.reason || metadata?.salesApi?.reason || "Sales API unavailable.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>{initialData?.id ? "Edit Scenario" : "New Scenario"}</DialogTitle>
            <Tabs value={policyVersion === 3 ? "simple" : "advanced"} onValueChange={handleTabChange} className="w-[300px]">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="simple">Simple</TabsTrigger>
                <TabsTrigger value="advanced">Advanced</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6 py-4">
          <div className="space-y-4">
            <div>
              <Label>Scenario Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Aggressive Vectus Match" />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional context..." />
            </div>
          </div>

          <div className="space-y-4 border-t pt-4">
            <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Scope (Filters)</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Division</Label>
                <Select
                  value={(Array.isArray(scope.division) ? scope.division[0] : scope.division) || "all"}
                  onValueChange={(v) => setScope({ ...scope, division: v === "all" ? undefined : v })}
                >
                  <SelectTrigger><SelectValue placeholder="All Divisions" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Divisions</SelectItem>
                    {scopesData?.divisions?.map((d) => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Category</Label>
                <Select
                  value={(Array.isArray(scope.category) ? scope.category[0] : scope.category) || "all"}
                  onValueChange={(v) => setScope({ ...scope, category: v === "all" ? undefined : v })}
                >
                  <SelectTrigger><SelectValue placeholder="All Categories" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {scopesData?.categories?.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground mt-1 leading-tight">Exact catalogue category; compound divisions stay one stored compound value and products appear once.</p>
              </div>
              <div>
                <Label>Competitor mapping</Label>
                <Select
                  value={scope.competitorMapped === undefined ? "any" : scope.competitorMapped ? "mapped" : "unmapped"}
                  onValueChange={(value) => setScope({
                    ...scope,
                    competitorMapped: value === "any" ? undefined : value === "mapped",
                  })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any mapping status</SelectItem>
                    <SelectItem value="mapped">Mapped competitors only</SelectItem>
                    <SelectItem value="unmapped">No mapped competitor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Series</Label>
                <Select
                  value={(Array.isArray(scope.series) ? scope.series[0] : scope.series) || "all"}
                  onValueChange={(value) => setScope({ ...scope, series: value === "all" ? undefined : value })}
                >
                  <SelectTrigger><SelectValue placeholder="All Series" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Series</SelectItem>
                    {scopesData?.series.map((series) => (
                      <SelectItem key={series} value={series}>{series}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label>Explicit Codes (comma separated)</Label>
                <Input
                  value={scope.explicitCodes?.join(", ") || ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    setScope({ ...scope, explicitCodes: val ? val.split(",").map((s) => s.trim()) : [] });
                  }}
                  placeholder="e.g. 10101, 10102"
                />
              </div>
              <div className="col-span-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <p className="font-semibold">Sales tier scope</p>
                <p className="mt-1">
                  {metadata?.salesApi?.components?.sales?.available
                    ? "Sales is connected. Turn on Use volume tiers in Strategy below to apply live A/B/C cumulative contribution; products with no FY sales remain a separate excluded group."
                    : "Connect the Sales feed to use live A/B/C cumulative contribution. Products with no FY sales remain a separate excluded group."}
                </p>
              </div>
              <div className="col-span-2 flex items-start space-x-3 border rounded-md p-3 bg-muted/20">
                <Checkbox
                  id="confidenceOnly"
                  checked={scope.confidenceOnly || false}
                  onCheckedChange={(checked) => setScope({ ...scope, confidenceOnly: !!checked })}
                  disabled={metadata?.salesApi?.status !== "authenticated"}
                  className="mt-1"
                />
                <div className="grid gap-1.5 leading-tight">
                  <Label htmlFor="confidenceOnly" className={metadata?.salesApi?.status !== "authenticated" ? "text-muted-foreground" : ""}>Confidence Pass Only</Label>
                  <p className="text-xs text-muted-foreground">Only evaluate products with current competitor under 12 months, FY sales, and usable non-held gross margin. Failures remain visible exclusions.</p>
                </div>
              </div>
            </div>
          </div>

          {policyVersion === 2 ? (
            isNativeP011 ? (
              <div className="space-y-6">

                <div className="grid grid-cols-2 gap-4 bg-muted/10 p-4 rounded-md border border-border/50">
                  <h4 className="col-span-2 font-medium text-sm flex items-center justify-between">
                    Competitor Selection
                  </h4>
                  <div>
                    <Label className="text-xs">Mode</Label>
                    <Select value={policy.competitor?.mode || "nearest"} onValueChange={(v: any) => setPolicy(p => ({ ...p, competitor: { ...p.competitor, mode: v } }))}>
                      <SelectTrigger className="h-8 bg-background"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="nearest">Nearest</SelectItem>
                        <SelectItem value="lowest">Lowest</SelectItem>
                        <SelectItem value="named">Named Competitor</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {policy.competitor?.mode === "named" && (
                    <div>
                      <Label className="text-xs">Named Competitor</Label>
                    <Select value={policy.competitor?.named || "none"} onValueChange={(v) => setPolicy(p => ({ ...p, competitor: { ...p.competitor, named: v === "none" ? null : v } }))}>
                      <SelectTrigger className="h-8 bg-background"><SelectValue placeholder="Select competitor" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none" disabled>Select competitor</SelectItem>
                        {scopesData?.competitors?.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className={policy.competitor?.mode === "named" ? "col-span-2 sm:col-span-1" : ""}>
                  <Label className="text-xs">Stale After (Days)</Label>
                  <Input type="number" value={policy.competitor?.staleAfterDays ?? 365} onChange={e => setPolicy(p => ({ ...p, competitor: { ...p.competitor, staleAfterDays: Number(e.target.value) } }))} className="h-8 bg-background" />
                </div>
                <div className="flex items-center gap-2 mt-auto pb-1">
                  <Checkbox id="exclude-stale" checked={policy.competitor?.excludeStale ?? true} onCheckedChange={c => setPolicy(p => ({ ...p, competitor: { ...p.competitor, excludeStale: !!c } }))} />
                  <Label htmlFor="exclude-stale" className="text-xs cursor-pointer">Exclude Stale Data</Label>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-4 bg-muted/10 p-4 rounded-md border border-border/50">
                <h4 className="col-span-4 font-medium text-sm">Band Boundaries (Cumulative Contribution)</h4>
                {['A', 'B', 'C', 'D'].map(band => (
                  <div key={band}>
                    <Label className="text-xs">Band {band} (%)</Label>
                    <Input type="number" step="1" value={((policy.bands as any)?.[band] ?? 0) * 100} onChange={e => setPolicy(p => ({ ...p, bands: { ...p.bands, [band]: Number(e.target.value) / 100 } }))} className="h-8 bg-background" />
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-5 gap-4 bg-muted/10 p-4 rounded-md border border-border/50">
                <h4 className="col-span-5 font-medium text-sm">Capture Shares Target (%)</h4>
                {['A', 'B', 'C', 'D', 'E'].map(band => (
                  <div key={band}>
                    <Label className="text-xs">Band {band}</Label>
                    <Input type="number" step="1" value={(policy.captureShares as any)?.[band] !== undefined ? ((policy.captureShares as any)[band] * 100) : ""} onChange={e => setPolicy(p => ({ ...p, captureShares: { ...p.captureShares, [band]: Number(e.target.value) / 100 } }))} className="h-8 bg-background" />
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-4 bg-muted/10 p-4 rounded-md border border-border/50">
                <h4 className="col-span-3 font-medium text-sm">Position Thresholds (%)</h4>
                <div>
                  <Label className="text-xs">Well Below/Above (±%)</Label>
                  <Input type="number" step="0.1" value={policy.position?.wellBelowAbove !== undefined ? policy.position.wellBelowAbove * 100 : ""} onChange={e => setPolicy(p => ({ ...p, position: { ...p.position, wellBelowAbove: Number(e.target.value) / 100 } }))} className="h-8 bg-background" />
                </div>
                <div>
                  <Label className="text-xs">Parity Below (-%)</Label>
                  <Input type="number" step="0.1" value={policy.position?.parityBelow !== undefined ? policy.position.parityBelow * 100 : ""} onChange={e => setPolicy(p => ({ ...p, position: { ...p.position, parityBelow: Number(e.target.value) / 100 } }))} className="h-8 bg-background" />
                </div>
                <div>
                  <Label className="text-xs">Parity Above (+%)</Label>
                  <Input type="number" step="0.1" value={policy.position?.parityAbove !== undefined ? policy.position.parityAbove * 100 : ""} onChange={e => setPolicy(p => ({ ...p, position: { ...p.position, parityAbove: Number(e.target.value) / 100 } }))} className="h-8 bg-background" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 bg-muted/10 p-4 rounded-md border border-border/50">
                <h4 className="col-span-3 font-medium text-sm">Safeguards & Global Rules</h4>
                <div>
                  <Label className="text-xs">Defend Undercut (%)</Label>
                  <Input type="number" step="0.1" value={policy.defendTargetUndercut !== undefined ? policy.defendTargetUndercut * 100 : ""} onChange={e => setPolicy(p => ({ ...p, defendTargetUndercut: Number(e.target.value) / 100 }))} className="h-8 bg-background" />
                </div>
                <div>
                  <Label className="text-xs">Max Increase (%)</Label>
                  <Input type="number" step="0.1" value={policy.maxIncreasePercent ?? ""} onChange={e => setPolicy(p => ({ ...p, maxIncreasePercent: Number(e.target.value) }))} className="h-8 bg-background" />
                </div>
                <div>
                  <Label className="text-xs">Max Decrease (%)</Label>
                  <Input type="number" step="0.1" value={policy.maxDecreasePercent ?? ""} onChange={e => setPolicy(p => ({ ...p, maxDecreasePercent: Number(e.target.value) }))} className="h-8 bg-background" />
                </div>
                <div>
                  <Label className="text-xs">Hold Below (₹)</Label>
                  <Input type="number" step="1" value={policy.holdThreshold ?? ""} onChange={e => setPolicy(p => ({ ...p, holdThreshold: Number(e.target.value) }))} className="h-8 bg-background" />
                </div>
                <div className="col-span-2 grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs">Rounding Unit</Label>
                    <Select value={policy.rounding?.unit?.toString() || "1"} onValueChange={(v) => setPolicy(p => ({ ...p, rounding: { ...p.rounding, unit: Number(v) } }))}>
                      <SelectTrigger className="h-8 bg-background"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1</SelectItem>
                        <SelectItem value="5">5</SelectItem>
                        <SelectItem value="10">10</SelectItem>
                        <SelectItem value="50">50</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Rounding Direction</Label>
                    <Select value={policy.rounding?.direction || "nearest"} onValueChange={(v: any) => setPolicy(p => ({ ...p, rounding: { ...p.rounding, direction: v } }))}>
                      <SelectTrigger className="h-8 bg-background"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="nearest">Nearest</SelectItem>
                        <SelectItem value="up">Up</SelectItem>
                        <SelectItem value="down">Down</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 bg-muted/10 p-4 rounded-md border border-border/50">
                <h4 className="col-span-3 font-medium text-sm">Portfolio Target</h4>
                <div>
                  <Label className="text-xs">Mode</Label>
                  <Select value={policy.portfolio?.mode || "hold_current"} onValueChange={(v: any) => setPolicy(p => ({ ...p, portfolio: { ...p.portfolio, mode: v } }))}>
                    <SelectTrigger className="h-8 bg-background"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hold_current">Hold Current</SelectItem>
                      <SelectItem value="improve_by_points">Improve by Points</SelectItem>
                      <SelectItem value="allow_decline_points">Allow Decline by Points</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Target Points</Label>
                  <Input type="number" step="0.1" disabled={policy.portfolio?.mode === "hold_current"} value={policy.portfolio?.points ?? ""} onChange={e => setPolicy(p => ({ ...p, portfolio: { ...p.portfolio, points: Number(e.target.value) } }))} className="h-8 bg-background" />
                </div>
                <div>
                  <Label className="text-xs">Margin Uplift Points</Label>
                  <Input type="number" step="0.1" value={policy.marginTargetUpliftPoints ?? ""} onChange={e => setPolicy(p => ({ ...p, marginTargetUpliftPoints: Number(e.target.value) }))} className="h-8 bg-background" />
                </div>
              </div>

              <div className="bg-muted/10 p-4 rounded-md border border-border/50">
                <h4 className="font-medium text-sm mb-3">Category Gross-Margin Floors (%)</h4>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                  {['PTMT', 'C P', 'PLUMBING', 'SANITARYWARE', 'SINK', 'HARDWARE'].map((cat) => (
                    <div key={cat}>
                      <Label className="text-xs truncate" title={cat}>{cat}</Label>
                      <Input type="number" min="0" max="99.9" step="0.1" value={(policy.categoryFloors as any)?.[cat] !== undefined ? (policy.categoryFloors as any)[cat] : ""} onChange={(e) => setPolicy(p => { const nextFloors = { ...p.categoryFloors }; if (e.target.value) { nextFloors[cat] = Number(e.target.value); } else { delete nextFloors[cat]; } return { ...p, categoryFloors: nextFloors }; })} className="h-8 bg-background text-xs" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : advancedPolicy ? (
              <div className="space-y-6">
                <div className="bg-muted/10 p-4 rounded-md border border-border/50 text-sm space-y-4">
                  <h4 className="font-semibold text-foreground uppercase tracking-wider">Promoted Advanced Policy</h4>
                  <p className="text-muted-foreground">
                    This scenario has been promoted to an Advanced bounds-based policy.
                    The underlying rules and constraints are generated by the backend and preserved here exactly as evaluated.
                  </p>

                  <div className="space-y-2">
                    <h5 className="font-medium">Evaluated Rules (Read-only)</h5>
                    <div className="border rounded-md divide-y bg-card text-xs">
                      {advancedPolicy.rules.map((rule: MrpGeneratorRule, idx: number) => (
                        <div key={idx} className="p-2 font-mono flex gap-2">
                          <span className="text-muted-foreground">{idx + 1}.</span>
                          <span>{JSON.stringify(rule)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                    <div>
                      <h5 className="font-medium text-xs text-muted-foreground mb-1">Hold Below Threshold</h5>
                      <div>{formatMoney(advancedPolicy.holdBelow)}</div>
                    </div>
                    <div>
                      <h5 className="font-medium text-xs text-muted-foreground mb-1">Rounding</h5>
                      <div>Nearest {formatMoney(advancedPolicy.rounding.unit)} ({advancedPolicy.rounding.direction})</div>
                    </div>
                    <div>
                      <h5 className="font-medium text-xs text-muted-foreground mb-1">Margin Floors</h5>
                      <div>{advancedPolicy.marginEnabled ? "Enabled" : "Disabled"}</div>
                      {advancedPolicy.categoryFloors && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {Object.entries(advancedPolicy.categoryFloors).map(([cat, val]) => `${cat}: ${val}%`).join(', ')}
                        </div>
                      )}
                    </div>
                    <div>
                      <h5 className="font-medium text-xs text-muted-foreground mb-1">Volume Tiers</h5>
                      <div>{advancedPolicy.volumeEnabled ? "Enabled" : "Disabled"}</div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null
          ) : policyVersion === 3 ? (
            <div className="space-y-6">
              <div className="flex flex-col gap-4 border-b pb-4">
                <p className="text-xs text-muted-foreground">
                  <strong>Three Working Modes:</strong> Competitive only (default), + margin floors (requires margin feed), + volume tiers (requires sales feed).
                </p>
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="margin-enabled"
                      checked={simplePolicy.marginEnabled}
                      disabled={noMargin}
                      onCheckedChange={(c) => setSimplePolicy({ ...simplePolicy, marginEnabled: !!c })}
                    />
                    <Label htmlFor="margin-enabled" className={`cursor-pointer ${noMargin ? 'text-muted-foreground' : ''}`}>
                      Apply gross-margin floors
                      <span className="block font-normal text-xs text-muted-foreground mt-0.5">
                        Uses margin from the Sales system. Currently Apr-Jun 2026.
                      </span>
                      {noMargin && (
                        <span className="block font-normal text-xs text-amber-600 mt-0.5">
                          {marginReason} {simplePolicy.marginEnabled ? "Run requires turning this off or waiting." : ""}
                        </span>
                      )}
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="volume-enabled"
                      checked={simplePolicy.volumeEnabled}
                      disabled={noVolume}
                      onCheckedChange={(c) => setSimplePolicy({ ...simplePolicy, volumeEnabled: !!c })}
                    />
                    <Label htmlFor="volume-enabled" className={`cursor-pointer ${noVolume ? 'text-muted-foreground' : ''}`}>
                      Use volume tiers
                      <span className="block font-normal text-xs text-muted-foreground mt-0.5">
                        Weighs suggestions by what actually sells.
                      </span>
                      {noVolume && (
                        <span className="block font-normal text-xs text-amber-600 mt-0.5">
                          {volumeReason} {simplePolicy.volumeEnabled ? "Run requires turning this off or waiting." : ""}
                        </span>
                      )}
                    </Label>
                  </div>
                </div>

                {simplePolicy.marginEnabled && (
                  <div className="bg-muted/10 p-4 rounded-md border border-border/50">
                    <h4 className="font-medium text-sm mb-3">Category Gross-Margin Floors (%)</h4>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                      {['PTMT', 'C P', 'PLUMBING', 'SANITARYWARE', 'SINK', 'HARDWARE'].map((cat) => {
                        const floors = simplePolicy.categoryFloors || {};
                        const val = floors[cat];
                        return (
                          <div key={cat}>
                            <Label className="text-xs truncate" title={cat}>{cat}</Label>
                            <Input type="number" min="0" max="99.9" step="0.1"
                              value={val !== undefined ? val : ""}
                              onChange={(e) => {
                                const nextFloors = { ...floors };
                                if (e.target.value) {
                                  nextFloors[cat] = Number(e.target.value);
                                } else {
                                  delete nextFloors[cat];
                                }
                                setSimplePolicy({ ...simplePolicy, categoryFloors: nextFloors });
                              }}
                              className="h-8 bg-background text-xs"
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {simplePolicy.volumeEnabled && (
                  <div className="bg-muted/10 p-3 rounded-md border border-border/50 text-xs text-muted-foreground">
                    <strong>Volume Tiers Active:</strong> A (top 80%), B (80-95%), C (95-100%). Unsold catalog items placed in band F.
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-sm uppercase tracking-wider text-foreground">Rule Table (Evaluated in Order)</h3>
                    {previewData?.summary && (
                      <div className="text-xs text-muted-foreground mt-1">
                        Preview: {previewData.summary.evaluated || 0} evaluated &middot; {previewData.summary.wouldChange || 0} would change &middot; {previewData.summary.noChange || 0} no change &middot; {previewData.summary.excluded || 0} excluded
                      </div>
                    )}
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => {
                    const nextRows = [...simplePolicy.rows];
                    nextRows.push({
                      id: Math.random().toString(36).slice(2, 9),
                      order: nextRows.length + 1,
                      label: "",
                      competitor: { mode: "nearest" },
                      appliesTo: { type: "all" },
                      target: { mode: "below", percent: 5 },
                      maxIncrease: 15,
                      maxDecrease: 5,
                    });
                    setSimplePolicy({ ...simplePolicy, rows: nextRows });
                  }}>
                    + Add row
                  </Button>
                </div>

                {!simplePolicy.rows.some(r => r.appliesTo.type === "all") && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 flex items-start gap-2">
                    <Info className="w-4 h-4 shrink-0" />
                    <span>
                      No catch-all row found. Products matching nothing are silently untouched.
                      {(previewData?.summary as any)?.fallthroughUntouched ? ` ${((previewData?.summary as any).fallthroughUntouched)} products currently fall through.` : " Add an \"all\" row at the end to ensure full coverage."}
                    </span>
                  </div>
                )}

                {simplePolicy.rows.length === 0 ? (
                  <div className="text-center py-6 text-sm text-muted-foreground border rounded-md border-dashed">
                    No rules defined. First match wins.
                  </div>
                ) : (
                  <div className="border rounded-md overflow-hidden bg-card text-sm">
                    <div className="grid grid-cols-[auto_1fr_1fr_1fr_1fr_auto] gap-2 p-2 border-b bg-muted/20 font-semibold uppercase text-xs tracking-wider text-muted-foreground">
                      <div className="w-8 text-center">#</div>
                      <div>Competitor</div>
                      <div>Applies To</div>
                      <div>Target</div>
                      <div>Limit</div>
                      <div className="w-24 text-right pr-2">Actions</div>
                    </div>
                    {simplePolicy.rows.map((row, idx) => {
                      const reach = previewData?.reach?.[row.id] as any;
                      return (
                      <div key={row.id} className="border-b last:border-0 p-2">
                        <div className="grid grid-cols-[auto_1fr_1fr_1fr_1fr_auto] gap-2 items-center">
                          <div className="w-8 text-center text-muted-foreground font-medium">{idx + 1}</div>

                          <div className="space-y-1">
                            <Select value={row.competitor.mode} onValueChange={(v: any) => {
                            const newRows = [...simplePolicy.rows];
                            newRows[idx] = { ...row, competitor: { ...row.competitor, mode: v } };
                            setSimplePolicy({ ...simplePolicy, rows: newRows });
                          }}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="nearest">nearest</SelectItem>
                              <SelectItem value="lowest">lowest</SelectItem>
                              <SelectItem value="named">named</SelectItem>
                            </SelectContent>
                          </Select>
                          {row.competitor.mode === "named" && (
                            <Select value={row.competitor.name || "none"} onValueChange={(v) => {
                              const newRows = [...simplePolicy.rows];
                              newRows[idx] = { ...row, competitor: { ...row.competitor, name: v === "none" ? null : v } };
                              setSimplePolicy({ ...simplePolicy, rows: newRows });
                            }}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Competitor" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none" disabled>Select</SelectItem>
                                {scopesData?.competitors?.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          )}
                        </div>

                        <div className="space-y-1">
                          <Select value={row.appliesTo.type} onValueChange={(v: any) => {
                            const newRows = [...simplePolicy.rows];
                            newRows[idx] = { ...row, appliesTo: { type: v, value: undefined }, catchAll: v === "all" };
                            setSimplePolicy({ ...simplePolicy, rows: newRows });
                          }}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">everything (catch-all)</SelectItem>
                              <SelectItem value="division">Division</SelectItem>
                              <SelectItem value="category">Category</SelectItem>
                              <SelectItem value="series">Series</SelectItem>
                              <SelectItem value="explicit_codes">Item Codes</SelectItem>
                            </SelectContent>
                          </Select>
                          {row.appliesTo.type !== "all" && row.appliesTo.type !== "explicit_codes" && (
                            <Input
                              placeholder="e.g. Black Pearl"
                              className="h-8 text-xs"
                              value={(Array.isArray(row.appliesTo.value) ? row.appliesTo.value.join(", ") : row.appliesTo.value) || ""}
                              onChange={(e) => {
                                const newRows = [...simplePolicy.rows];
                                newRows[idx] = { ...row, appliesTo: { ...row.appliesTo, value: e.target.value } };
                                setSimplePolicy({ ...simplePolicy, rows: newRows });
                              }}
                            />
                          )}
                          {row.appliesTo.type === "explicit_codes" && (
                            <Input
                              placeholder="comma separated"
                              className="h-8 text-xs"
                              value={(Array.isArray(row.appliesTo.value) ? row.appliesTo.value.join(", ") : row.appliesTo.value) || ""}
                              onChange={(e) => {
                                const newRows = [...simplePolicy.rows];
                                newRows[idx] = { ...row, appliesTo: { ...row.appliesTo, value: e.target.value.split(",").map(s => s.trim()) } };
                                setSimplePolicy({ ...simplePolicy, rows: newRows });
                              }}
                            />
                          )}
                        </div>

                        <div className="space-y-1">
                          <Select value={row.target.mode} onValueChange={(v: any) => {
                            const newRows = [...simplePolicy.rows];
                            newRows[idx] = { ...row, target: { mode: v, percent: v === "match" ? undefined : 5 } };
                            setSimplePolicy({ ...simplePolicy, rows: newRows });
                          }}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="below">% below</SelectItem>
                              <SelectItem value="match">match</SelectItem>
                              <SelectItem value="above">% above</SelectItem>
                              <SelectItem value="close_gap">close % gap</SelectItem>
                            </SelectContent>
                          </Select>
                          {row.target.mode !== "match" && (
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                className="h-8 text-xs w-full"
                                value={row.target.percent ?? ""}
                                onChange={(e) => {
                                  const newRows = [...simplePolicy.rows];
                                  newRows[idx] = { ...row, target: { ...row.target, percent: Number(e.target.value) } };
                                  setSimplePolicy({ ...simplePolicy, rows: newRows });
                                }}
                              />
                              <span className="text-xs text-muted-foreground">%</span>
                            </div>
                          )}
                        </div>

                        <div className="space-y-1">
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-muted-foreground whitespace-nowrap">Max+</span>
                            <Input
                              type="number"
                              className="h-8 text-xs w-full"
                              value={row.maxIncrease ?? ""}
                              onChange={(e) => {
                                const newRows = [...simplePolicy.rows];
                                newRows[idx] = { ...row, maxIncrease: e.target.value ? Number(e.target.value) : null };
                                setSimplePolicy({ ...simplePolicy, rows: newRows });
                              }}
                            />
                            <span className="text-xs text-muted-foreground">%</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-muted-foreground whitespace-nowrap">Max-</span>
                            <Input
                              type="number"
                              className="h-8 text-xs w-full"
                              value={row.maxDecrease ?? ""}
                              onChange={(e) => {
                                const newRows = [...simplePolicy.rows];
                                newRows[idx] = { ...row, maxDecrease: e.target.value ? Number(e.target.value) : null };
                                setSimplePolicy({ ...simplePolicy, rows: newRows });
                              }}
                            />
                            <span className="text-xs text-muted-foreground">%</span>
                          </div>
                        </div>

                        <div className="flex items-center justify-end gap-1">
                          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                            if (idx === 0) return;
                            const newRows = [...simplePolicy.rows];
                            const temp = newRows[idx];
                            newRows[idx] = newRows[idx - 1];
                            newRows[idx - 1] = temp;
                            // Update orders
                            newRows.forEach((r, i) => r.order = i + 1);
                            setSimplePolicy({ ...simplePolicy, rows: newRows });
                          }} disabled={idx === 0}>
                            <ArrowUp className="w-3 h-3" />
                          </Button>
                          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                            if (idx === simplePolicy.rows.length - 1) return;
                            const newRows = [...simplePolicy.rows];
                            const temp = newRows[idx];
                            newRows[idx] = newRows[idx + 1];
                            newRows[idx + 1] = temp;
                            // Update orders
                            newRows.forEach((r, i) => r.order = i + 1);
                            setSimplePolicy({ ...simplePolicy, rows: newRows });
                          }} disabled={idx === simplePolicy.rows.length - 1}>
                            <ArrowDown className="w-3 h-3" />
                          </Button>
                          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => {
                            const newRows = simplePolicy.rows.filter((_, i) => i !== idx);
                            newRows.forEach((r, i) => r.order = i + 1);
                            setSimplePolicy({ ...simplePolicy, rows: newRows });
                          }}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>

                      {reach && (
                        <div className="mt-2 ml-10 text-xs text-muted-foreground bg-muted/10 p-1.5 rounded inline-block">
                          {typeof reach === 'object'
                            ? (
                              <div className="flex flex-wrap gap-x-2 gap-y-1">
                                <span>Matches: {reach.scopeMatched || 0} products</span>
                                <span>&middot;</span>
                                <span>{reach.withCompetitorPrice || 0} have {row.competitor.name || row.competitor.mode} price</span>
                                <span>&middot;</span>
                                <span>{reach.wouldChange || 0} would change</span>
                                {reach.matchedFySalesValue != null && (
                                  <>
                                    <span>&middot;</span>
                                    <span className="text-emerald-700">{formatMoney(reach.matchedFySalesValue)} FY Sales</span>
                                  </>
                                )}
                              </div>
                            )
                            : `Matches: ${reach}`}
                        </div>
                      )}
                      </div>
                    )})}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4 bg-muted/10 p-4 rounded-md border border-border/50">
                <h4 className="col-span-2 font-medium text-sm">Global Thresholds</h4>
                <div>
                  <Label className="text-xs">Hold Below (₹)</Label>
                  <Input type="number" step="1" value={simplePolicy.holdBelow ?? ""} onChange={e => setSimplePolicy({ ...simplePolicy, holdBelow: Number(e.target.value) })} className="h-8 bg-background" />
                  <p className="text-xs text-muted-foreground mt-1">Products below this MRP are not reduced further.</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Round Unit</Label>
                    <Select value={simplePolicy.rounding?.unit?.toString() || "1"} onValueChange={(v) => setSimplePolicy({ ...simplePolicy, rounding: { ...simplePolicy.rounding, unit: Number(v) } })}>
                      <SelectTrigger className="h-8 bg-background"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1</SelectItem>
                        <SelectItem value="5">5</SelectItem>
                        <SelectItem value="10">10</SelectItem>
                        <SelectItem value="50">50</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Direction</Label>
                    <Select value={simplePolicy.rounding?.direction || "nearest"} onValueChange={(v: any) => setSimplePolicy({ ...simplePolicy, rounding: { ...simplePolicy.rounding, direction: v } })}>
                      <SelectTrigger className="h-8 bg-background"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="nearest">Nearest</SelectItem>
                        <SelectItem value="up">Up</SelectItem>
                        <SelectItem value="down">Down</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Rules (Ordered)</h3>
                <Select onValueChange={(v) => addRule(v as MrpGeneratorRule["type"])}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Add Rule..." />
                  </SelectTrigger>
                  <SelectContent>
                    {ALL_RULE_TYPES.map((type) => {
                      const isDisabled = disabledRules.has(type);
                      return (
                        <SelectItem key={type} value={type} disabled={isDisabled}>
                          {type} {isDisabled && "(Disabled)"}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {(metadata?.disabledRules ?? []).map((rule) => (
                  <div key={rule.type} className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    <p className="font-semibold">{rule.type} rule unavailable</p>
                    <p className="mt-1">{rule.reason}</p>
                    <p className="mt-2 font-medium">{rule.configurationSummary}</p>
                  </div>
                ))}
              </div>

              {rules.length === 0 ? (
                <div className="text-center py-6 text-sm text-muted-foreground border rounded-md border-dashed">
                  No rules defined. Add a rule to evaluate pricing.
                </div>
              ) : (
                <div className="space-y-2">
                  {rules.map((rule, idx) => {
                    const isDisabled = disabledRules.has(rule.type);
                    return (
                      <div key={idx} className={`flex items-start gap-3 p-3 border rounded-md ${isDisabled ? 'bg-muted/50 opacity-60' : 'bg-card'}`}>
                        <div className="flex flex-col gap-1 shrink-0 pt-1">
                          <button type="button" onClick={() => moveRule(idx, -1)} disabled={idx === 0} className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30">
                            <ArrowUp className="w-4 h-4" />
                          </button>
                          <button type="button" onClick={() => moveRule(idx, 1)} disabled={idx === rules.length - 1} className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30">
                            <ArrowDown className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="flex-1 space-y-3">
                          <div className="font-medium text-sm flex items-center justify-between">
                            <span>{idx + 1}. {rule.type}</span>
                            {isDisabled && (
                              <span className="text-xs flex items-center gap-1 text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                                <Info className="w-3 h-3" /> Sales API not available
                              </span>
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            {rule.type === "percent_below" && (
                              <>
                                <div>
                                  <Label className="text-xs">Competitor</Label>
                                  <Select value={rule.competitor || "all"} onValueChange={(v) => updateRule(idx, { competitor: v === "all" ? "" : v })}>
                                    <SelectTrigger className="h-8"><SelectValue placeholder="Select competitor" /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="choose" disabled>Choose competitor</SelectItem>
                                      {scopesData?.competitors?.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div>
                                  <Label className="text-xs">Percent Below</Label>
                                  <Input type="number" step="0.1" value={rule.percent} onChange={(e) => updateRule(idx, { percent: Number(e.target.value) })} className="h-8" />
                                </div>
                              </>
                            )}
                            {rule.type === "match" && (
                              <div className="col-span-2">
                                <Label className="text-xs">Competitor</Label>
                                <Select value={rule.competitor || "all"} onValueChange={(v) => updateRule(idx, { competitor: v === "all" ? "" : v })}>
                                  <SelectTrigger className="h-8"><SelectValue placeholder="Select competitor" /></SelectTrigger>
                                  <SelectContent>
                                      <SelectItem value="choose" disabled>Choose competitor</SelectItem>
                                    {scopesData?.competitors?.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                            {rule.type === "percent_above_lowest" && (
                              <div>
                                <Label className="text-xs">Percent Above</Label>
                                <Input type="number" step="0.1" value={rule.percent} onChange={(e) => updateRule(idx, { percent: Number(e.target.value) })} className="h-8" />
                              </div>
                            )}
                            {(rule.type === "max_increase" || rule.type === "max_decrease") && (
                              <div>
                                <Label className="text-xs">Percent</Label>
                                <Input type="number" step="0.1" value={rule.percent} onChange={(e) => updateRule(idx, { percent: Number(e.target.value) })} className="h-8" />
                              </div>
                            )}
                            {rule.type === "hold_below" && (
                              <div>
                                <Label className="text-xs">Threshold (₹)</Label>
                                <Input type="number" step="1" value={rule.threshold} onChange={(e) => updateRule(idx, { threshold: Number(e.target.value) })} className="h-8" />
                              </div>
                            )}
                            {rule.type === "rounding" && (
                              <>
                                <div>
                                  <Label className="text-xs">Unit</Label>
                                  <Select value={rule.unit.toString()} onValueChange={(v) => updateRule(idx, { unit: Number(v) as 1|5|10|50 })}>
                                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="1">1</SelectItem>
                                      <SelectItem value="5">5</SelectItem>
                                      <SelectItem value="10">10</SelectItem>
                                      <SelectItem value="50">50</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div>
                                  <Label className="text-xs">Direction</Label>
                                  <Select value={rule.direction} onValueChange={(v: "nearest"|"up"|"down") => updateRule(idx, { direction: v })}>
                                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="nearest">Nearest</SelectItem>
                                      <SelectItem value="up">Up</SelectItem>
                                      <SelectItem value="down">Down</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              </>
                            )}
                            {rule.type === "margin_floor" && (
                              <div className="col-span-2 grid grid-cols-3 gap-3 rounded border bg-muted/40 p-3">
                                <div className="col-span-3 flex justify-between items-center mb-1">
                                  <span className="text-xs font-semibold uppercase text-muted-foreground">Category Floors (%)</span>
                                  <Button type="button" variant="outline" size="sm" className="h-6 text-xs" onClick={() => updateRule(idx, { categoryFloors: { PTMT: 65, "C P": 38, PLUMBING: 30, SANITARYWARE: 38, SINK: 40, HARDWARE: 38 } })}>Fill Defaults</Button>
                                </div>
                                {["PTMT", "C P", "PLUMBING", "SANITARYWARE", "SINK", "HARDWARE"].map((cat) => (
                                  <div key={cat}>
                                    <Label className="text-xs">{cat}</Label>
                                    <Input type="number" step="0.1" value={(rule as any).categoryFloors?.[cat] ?? ""} onChange={(e) => updateRule(idx, { categoryFloors: { ...(rule as any).categoryFloors, [cat]: e.target.value ? Number(e.target.value) : undefined } })} className="h-8 bg-background" />
                                  </div>
                                ))}
                              </div>
                            )}
                            {rule.type === "volume_tier" && (
                              <div className="col-span-2 grid grid-cols-2 gap-3 rounded border bg-muted/40 p-3">
                                <div>
                                  <Label className="text-xs">Period</Label>
                                  <Input value="2026-27" readOnly className="h-8 bg-muted text-muted-foreground" />
                                </div>
                                <div>
                                  <Label className="text-xs">Mode</Label>
                                  <Select value={(rule as any).mode || ""} onValueChange={(v: "cumulative_contribution" | "value_threshold") => {
                                    if (v === "cumulative_contribution") {
                                      updateRule(idx, { mode: v, tier: "A", cumulativeValuePercent: 80, operator: undefined, salesValue: undefined } as any);
                                    } else {
                                      updateRule(idx, { mode: v, operator: "above", salesValue: 100000, tier: undefined, cumulativeValuePercent: undefined } as any);
                                    }
                                  }}>
                                    <SelectTrigger className="h-8 bg-background"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="cumulative_contribution">Cumulative Contribution</SelectItem>
                                      <SelectItem value="value_threshold">Value Threshold</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                {(rule as any).mode === "cumulative_contribution" && (
                                  <div className="col-span-2">
                                    <Label className="text-xs">Target Tier</Label>
                                    <Select value={(rule as any).tier || ""} onValueChange={(v: "A"|"B"|"C") => updateRule(idx, { tier: v, cumulativeValuePercent: v === "A" ? 80 : v === "B" ? 95 : 100 } as any)}>
                                      <SelectTrigger className="h-8 bg-background"><SelectValue /></SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="A">Tier A (Top 80%)</SelectItem>
                                        <SelectItem value="B">Tier B (80% - 95%)</SelectItem>
                                        <SelectItem value="C">Tier C (Bottom 5%)</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                )}
                                {(rule as any).mode === "value_threshold" && (
                                  <>
                                    <div>
                                      <Label className="text-xs">Operator</Label>
                                      <Select value={(rule as any).operator || ""} onValueChange={(v: "above"|"below") => updateRule(idx, { operator: v } as any)}>
                                        <SelectTrigger className="h-8 bg-background"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="above">Above</SelectItem>
                                          <SelectItem value="below">Below</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    <div>
                                      <Label className="text-xs">Sales Value (₹)</Label>
                                      <Input type="number" step="1" value={(rule as any).salesValue ?? ""} onChange={(e) => updateRule(idx, { salesValue: Number(e.target.value) } as any)} className="h-8 bg-background" />
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                        <button type="button" onClick={() => removeRule(idx)} className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors shrink-0">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {(formError || error || validationError) && (
            <div className="text-destructive text-sm">{formError || error || validationError}</div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSaving || !!validationError}>{isSaving ? "Saving..." : "Save Scenario"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
