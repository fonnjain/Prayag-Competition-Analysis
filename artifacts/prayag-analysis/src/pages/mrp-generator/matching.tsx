import React, { useState, useMemo, useRef, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import {
  useGetMrpMatchingWorkbench,
  getGetMrpMatchingWorkbenchQueryKey,
  useSaveMrpMatchingSession,
  MrpMatchingActionAction,
  GetMrpMatchingWorkbenchParams,
  MrpMatchingWorkbenchFilter,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Save, Filter, Search, ArrowRight, Target, Minus, Edit3, CornerDownRight, Zap } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

export default function MrpMatchingWorkbench() {
  const [location, setLocation] = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  const division = searchParams.get("division") || "";
  const category = searchParams.get("category") || "";
  const competitors = searchParams.getAll("competitors");
  const initialDriver = searchParams.get("driver") || "lowest";

  const { data, isLoading, error } = useGetMrpMatchingWorkbench({
    division,
    category: category || undefined,
    competitors: competitors.length > 0 ? competitors : [""], // api needs at least 1
    driver: initialDriver,
    filter: "all",
  }, {
    query: {
      enabled: !!division && competitors.length > 0,
      queryKey: getGetMrpMatchingWorkbenchQueryKey({ division, category: category || undefined, competitors, driver: initialDriver }),
    }
  });

  const saveSession = useSaveMrpMatchingSession();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [actions, setActions] = useState<Record<string, { action: MrpMatchingActionAction; percent?: number; price?: number; driver?: string }>>({});
  const [bulkActionsList, setBulkActionsList] = useState<Array<{ action: MrpMatchingActionAction; percent?: number; price?: number; driver?: string; filteredCodes: string[]; filter: MrpMatchingWorkbenchFilter }>>([]);
  const [globalFilter, setGlobalFilter] = useState<MrpMatchingWorkbenchFilter>("above");
  const [search, setSearch] = useState("");

  const [bulkAction, setBulkAction] = useState<MrpMatchingActionAction>("match");
  const [bulkPercent, setBulkPercent] = useState<number>(5);
  const [bulkPrice, setBulkPrice] = useState<number | "">("");
  const [bulkDriver, setBulkDriver] = useState<string>("global");

  const products = (data?.products || []) as any[];

  const getDriverPrice = (p: any, driverName: string | undefined) => {
    const driver = driverName || initialDriver;
    const candidates = (p.competitors || []).filter((c: any) => c.matched && c.normalizedPrice != null);
    if (!candidates.length) return null;

    if (driver === "lowest") {
      return Math.min(...candidates.map((c: any) => c.normalizedPrice));
    } else if (driver === "highest") {
      return Math.max(...candidates.map((c: any) => c.normalizedPrice));
    } else {
      const named = candidates.find((c: any) => c.competitor.toLowerCase() === driver.toLowerCase());
      return named?.normalizedPrice ?? null;
    }
  };

  // Filter products client-side for immediate feedback
  const visibleProducts = useMemo(() => {
    return products.filter((p: any) => {
      if (globalFilter !== "all" && p.position !== globalFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!p.itemCode.toLowerCase().includes(q) && !(p.productName || "").toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    }).sort((a: any, b: any) => {
      // most-above first
      return (b.signedPositionPercent ?? Number.NEGATIVE_INFINITY) - (a.signedPositionPercent ?? Number.NEGATIVE_INFINITY) ||
        a.itemCode.localeCompare(b.itemCode);
    });
  }, [products, globalFilter, search]);

  const handleApplyBulk = () => {
    if (bulkAction === "set" && !bulkPrice) return;
    if (visibleProducts.length === 0) return;
    
    setBulkActionsList(prev => [...prev, {
      action: bulkAction,
      ...(bulkAction === "less_by_percent" ? { percent: bulkPercent } : {}),
      ...(bulkAction === "set" ? { price: Number(bulkPrice) } : {}),
      ...(bulkDriver !== "global" ? { driver: bulkDriver } : {}),
      filteredCodes: visibleProducts.map(p => p.itemCode),
      filter: globalFilter,
    }]);
    
    toast({ title: "Bulk action applied", description: `Applied to ${visibleProducts.length} visible items.` });
  };

  const hasDecisions = Object.keys(actions).length > 0 || bulkActionsList.length > 0;

  const handleSave = () => {
    if (!division || competitors.length === 0 || !hasDecisions) return;
    
    const finalBulkActions = bulkActionsList.map(b => ({
      visibleCodes: b.filteredCodes,
      filteredCodes: b.filteredCodes,
      filter: b.filter,
      action: b.action,
      percent: b.percent,
      price: b.price,
      driver: b.driver ? (b.driver === "lowest" || b.driver === "highest" ? b.driver : { named: b.driver }) : undefined
    }));

    const finalActions = Object.entries(actions).map(([itemCode, act]) => ({
      itemCode,
      action: act.action,
      percent: act.percent,
      price: act.price,
      driver: act.driver ? (act.driver === "lowest" || act.driver === "highest" ? act.driver : { named: act.driver }) : undefined
    }));

    saveSession.mutate({
      data: {
        division,
        category: category || undefined,
        selectedCompetitors: competitors,
        driver: initialDriver === "lowest" || initialDriver === "highest" ? initialDriver : { named: initialDriver },
        actions: finalActions,
        bulkActions: finalBulkActions,
      }
    }, {
      onSuccess: (res) => {
        toast({ title: "Matching Session Saved", description: `Created run #${res.runId}` });
        setLocation(`/mrp-generator/runs/${res.runId}`);
      },
      onError: (err: any) => {
        const msg = err?.data?.error || err?.message || "Failed to save session.";
        toast({ title: "Failed to save", description: msg, variant: "destructive" });
      }
    });
  };

  const updateAction = (itemCode: string, updates: Partial<{ action: MrpMatchingActionAction; percent: number; price: number; driver: string }>) => {
    setActions(prev => {
      const current = prev[itemCode] || { action: "leave" };
      const next = { ...current, ...updates };
      if (next.action === "less_by_percent" && next.percent == null) next.percent = 5;
      return { ...prev, [itemCode]: next };
    });
  };

  if (!division || competitors.length === 0) {
    return <div className="p-8 text-center text-muted-foreground">Please select a scope and competitors from the generator list to begin.</div>;
  }

  if (isLoading) return <div className="p-8"><Skeleton className="h-10 w-64 mb-4" /><Skeleton className="h-[500px] w-full" /></div>;
  if (error || !data) return <div className="p-8 text-destructive">Failed to load matching workbench.</div>;

  return (
    <div className="flex flex-col min-h-full bg-muted/20 pb-20">
      <div className="border-b bg-card px-4 py-3 sm:px-6 flex items-center justify-between gap-3 sticky top-0 z-10 shadow-sm">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Matching MRP Workbench</h1>
          <p className="text-sm text-muted-foreground">
            Scope: <strong className="text-foreground">{division}{category ? ` / ${category === "__uncategorised__" ? "Uncategorised" : category}` : ""}</strong> &middot; 
            Competitors: <strong className="text-foreground">{competitors.join(", ")}</strong>
          </p>
        </div>
        <Button onClick={handleSave} disabled={saveSession.isPending || !hasDecisions}>
          {saveSession.isPending ? "Saving..." : <><Save className="w-4 h-4 mr-2" /> Save &amp; Review Run</>}
        </Button>
      </div>

      <div className="p-4 sm:p-6 max-w-[1600px] mx-auto w-full space-y-6">
        
        {/* Controls */}
        <div className="bg-card border p-4 rounded-lg shadow-sm space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[200px] max-w-sm relative">
              <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
              <Input placeholder="Search codes..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 bg-background" />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <Select value={globalFilter} onValueChange={(v: MrpMatchingWorkbenchFilter) => setGlobalFilter(v)}>
                <SelectTrigger className="w-32 bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="above">Above Target</SelectItem>
                  <SelectItem value="below">Below Target</SelectItem>
                  <SelectItem value="all">All Products</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="pt-4 border-t flex flex-wrap items-end gap-3 bg-muted/20 p-3 rounded">
            <div className="text-sm font-medium text-foreground w-full sm:w-auto">Bulk Action (Visible)</div>
            
            <div className="w-40">
              <Select value={bulkAction} onValueChange={(v: any) => {
                setBulkAction(v);
                if (v === "less_by_percent" && bulkPercent == null) setBulkPercent(5);
              }}>
                <SelectTrigger className="h-9 bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="match">Match Target</SelectItem>
                  <SelectItem value="less_by_percent">Less by N%</SelectItem>
                  <SelectItem value="leave">Leave As-Is</SelectItem>
                  <SelectItem value="set">Set Exact Price</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(bulkAction === "match" || bulkAction === "less_by_percent") && (
              <div className="w-32">
                <Select value={bulkDriver} onValueChange={setBulkDriver}>
                  <SelectTrigger className="h-9 bg-background"><SelectValue placeholder="Driver" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="global">Global ({initialDriver})</SelectItem>
                    <SelectItem value="lowest">Lowest</SelectItem>
                    <SelectItem value="highest">Highest</SelectItem>
                    {competitors.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {bulkAction === "less_by_percent" && (
              <div className="w-24">
                <Input type="number" value={bulkPercent} onChange={e => setBulkPercent(Number(e.target.value))} className="h-9 bg-background" placeholder="%" />
              </div>
            )}
            
            {bulkAction === "set" && (
              <div className="w-24">
                <Input type="number" value={bulkPrice} onChange={e => setBulkPrice(e.target.value ? Number(e.target.value) : "")} className="h-9 bg-background" placeholder="₹" />
              </div>
            )}

            <Button variant="secondary" size="sm" onClick={handleApplyBulk} className="h-9">
              Apply to {visibleProducts.length} visible items
            </Button>
            {bulkActionsList.length > 0 && (
              <span className="text-xs text-primary font-medium ml-2">
                {bulkActionsList.length} bulk action(s) applied
              </span>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="bg-card border rounded-lg shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left whitespace-nowrap">
              <thead className="bg-muted/40 border-b text-xs uppercase text-muted-foreground font-semibold tracking-wider">
                <tr>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Prayag MRP</th>
                  {competitors.map(c => <th key={c} className="px-4 py-3">{c}</th>)}
                  <th className="px-4 py-3">Target Driver</th>
                  <th className="px-4 py-3">Position</th>
                  <th className="px-4 py-3 border-l">Action / Draft</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {visibleProducts.length === 0 ? (
                  <tr><td colSpan={5 + competitors.length} className="p-8 text-center text-muted-foreground">No products match current filters.</td></tr>
                ) : visibleProducts.map((p: any) => {
                  let rowBulk;
                  for (let i = bulkActionsList.length - 1; i >= 0; i--) {
                    if (bulkActionsList[i].filteredCodes.includes(p.itemCode)) {
                      rowBulk = bulkActionsList[i];
                      break;
                    }
                  }
                  
                  const manualAct = actions[p.itemCode];
                  const act = manualAct || rowBulk || { action: "leave" };
                  
                  const targetPrice = getDriverPrice(p, act.driver);
                  const effectiveDriver = act.driver || initialDriver;
                  
                  let draftMrp = p.currentMrp;
                  if (act.action === "match" && targetPrice != null) draftMrp = targetPrice;
                  if (act.action === "less_by_percent" && targetPrice != null) draftMrp = targetPrice * (1 - (act.percent || 0)/100);
                  if (act.action === "set" && act.price != null) draftMrp = act.price;

                  const isModified = act.action !== "leave";

                  return (
                    <tr key={p.itemCode} className={cn("hover:bg-muted/10 transition-colors", isModified && "bg-primary/5")}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{p.itemCode}</div>
                        <div className="text-xs text-muted-foreground truncate w-48" title={p.productName}>{p.productName}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">₹{p.currentMrp?.toFixed(2) ?? "-"}</div>
                      </td>
                      {competitors.map(comp => {
                        const matchedC = (p.competitors || []).find((c: any) => c.competitor === comp);
                        return (
                          <td key={comp} className="px-4 py-3">
                            {matchedC?.matched && matchedC.normalizedPrice != null ? (
                              <div className="font-medium">₹{matchedC.normalizedPrice.toFixed(2)}</div>
                            ) : (
                              <span className="text-muted-foreground italic text-xs">No data</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-4 py-3 bg-muted/5">
                        {targetPrice != null ? (
                          <>
                            <div className="font-medium text-emerald-700">₹{targetPrice.toFixed(2)}</div>
                            <div className="text-xs text-muted-foreground">via {effectiveDriver}</div>
                          </>
                        ) : (
                          <span className="text-muted-foreground italic">No evidence</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {p.signedPositionPercent != null ? (
                          <div className={cn("font-medium", p.position === "above" ? "text-amber-600" : p.position === "below" ? "text-emerald-600" : "")}>
                            {p.position === "above" ? "+" : ""}{p.signedPositionPercent.toFixed(1)}%
                          </div>
                        ) : "-"}
                      </td>
                      <td className="px-4 py-3 border-l">
                        <div className="flex items-center gap-2">
                          <Select value={act.action} onValueChange={(v: any) => updateAction(p.itemCode, { action: v })}>
                            <SelectTrigger className="w-[120px] h-8 bg-background text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="match">Match Target</SelectItem>
                              <SelectItem value="less_by_percent">Less by N%</SelectItem>
                              <SelectItem value="set">Set Price</SelectItem>
                              <SelectItem value="leave">Leave As-Is</SelectItem>
                            </SelectContent>
                          </Select>

                          {(act.action === "match" || act.action === "less_by_percent") && (
                            <Select value={act.driver || "global"} onValueChange={(v) => updateAction(p.itemCode, { driver: v === "global" ? undefined : v })}>
                              <SelectTrigger className="w-[110px] h-8 bg-background text-xs" title="Row Driver Override"><SelectValue placeholder="Driver" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="global">Global ({initialDriver})</SelectItem>
                                <SelectItem value="lowest">Lowest</SelectItem>
                                <SelectItem value="highest">Highest</SelectItem>
                                {competitors.map((c) => (
                                  <SelectItem key={c} value={c}>{c}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}

                          {act.action === "less_by_percent" && (
                            <Input 
                              type="number" 
                              value={act.percent ?? 5} 
                              onChange={e => updateAction(p.itemCode, { percent: Number(e.target.value) })}
                              className="w-16 h-8 bg-background text-xs px-2" 
                              placeholder="%" 
                            />
                          )}

                          {act.action === "set" && (
                            <Input 
                              type="number" 
                              value={act.price ?? ""} 
                              onChange={e => updateAction(p.itemCode, { price: e.target.value ? Number(e.target.value) : undefined })}
                              className="w-20 h-8 bg-background text-xs px-2" 
                              placeholder="₹" 
                            />
                          )}

                          {isModified && (
                            <div className="flex items-center gap-1 ml-auto bg-background border px-2 py-1 rounded shadow-sm text-xs font-medium text-primary whitespace-nowrap">
                              <CornerDownRight className="w-3 h-3" />
                              ₹{draftMrp?.toFixed(2) ?? "?"}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}
