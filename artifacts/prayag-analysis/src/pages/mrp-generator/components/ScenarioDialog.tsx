import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, ArrowUp, ArrowDown, Info } from "lucide-react";
import { MrpGeneratorScope, MrpGeneratorRule, ALL_RULE_TYPES } from "../types";
import { useGetMrpGeneratorScopes, useGetMrpGeneratorMetadata } from "@workspace/api-client-react";

interface ScenarioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialData?: {
    id?: number;
    name: string;
    description: string | null;
    scope: MrpGeneratorScope;
    rules: MrpGeneratorRule[];
  };
  onSave: (data: { name: string; description: string | null; scope: MrpGeneratorScope; rules: MrpGeneratorRule[] }) => void;
  isSaving: boolean;
  error?: string | null;
}

export function ScenarioDialog({ open, onOpenChange, initialData, onSave, isSaving, error }: ScenarioDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<MrpGeneratorScope>({});
  const [rules, setRules] = useState<MrpGeneratorRule[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

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
      setFormError(null);
    }
  }, [open, initialData]);

  const validationError = (() => {
    if (!name.trim()) return "Enter a scenario name.";
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
    onSave({
      name: name.trim(),
      description: description.trim() || null,
      scope: { ...scope, explicitCodes: explicitCodes.length ? explicitCodes : undefined },
      rules: rules.filter((rule) => !disabledRules.has(rule.type)),
    });
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initialData?.id ? "Edit Scenario" : "New Scenario"}</DialogTitle>
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
                  When the Sales API is connected, scope can use A/B/C cumulative contribution or an explicit period sales-value threshold. Products with no sales will remain a separate excluded group.
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

          <div className="space-y-4 border-t pt-4">
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
