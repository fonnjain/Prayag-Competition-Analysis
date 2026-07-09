import { useState, useEffect, Fragment, useMemo } from "react";
import { 
  useGetMappingReview,
  useUpdateCompetitorMapping,
  useBulkUpdateCompetitorMappings,
  useAutoAcceptMappings,
  useGetAutoAcceptPreview,
  getGetAutoAcceptPreviewQueryKey,
  useGetComparisonFilters,
  useGetAcceptBatches,
  useRecordAcceptBatch,
  useDeleteAcceptBatch,
  getGetAcceptBatchesQueryKey,
  getGetMappingReviewQueryKey,
  getGetComparisonQueryKey,
  getGetComparisonSummaryQueryKey,
  getGetComparisonFiltersQueryKey
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, ChevronLeft, ChevronRight, Save, Sparkles, Check, Zap, Download, Undo2, History } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

const TIER_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

const THRESHOLD_LABELS: Record<string, string> = {
  high: "High only",
  medium: "Medium & up",
  low: "All suggestions",
};

function formatBatchTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  return new Date(iso).toLocaleString();
}

function ConfidenceBadge({ confidence }: { confidence?: string | null }) {
  if (!confidence) return <span className="text-muted-foreground text-xs">-</span>;
  const tier = confidence.toLowerCase();
  const styles =
    tier === "high"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
      : tier === "medium"
      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
      : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
  return (
    <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide", styles)}>
      {confidence}
    </span>
  );
}

export default function MappingReviewPage() {
  const [search, setSearch] = useState("");
  const [competitor, setCompetitor] = useState<string>("all");
  const [confidence, setConfidence] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [editingRows, setEditingRows] = useState<Record<number, { code: string, status: string }>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [threshold, setThreshold] = useState<string>("high");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    setPage(1);
  }, [search, competitor, confidence]);

  // Selection is scoped to the current filter/page; reset it whenever the
  // visible set changes so stale ids never get accepted.
  useEffect(() => {
    setSelected(new Set());
  }, [search, competitor, confidence, page]);

  const { data: filters } = useGetComparisonFilters();

  const previewParams = {
    competitor: competitor !== "all" ? competitor : undefined,
    confidence: confidence !== "all" ? confidence : undefined,
    search: search || undefined,
  };
  const { data: autoAcceptPreview } = useGetAutoAcceptPreview(previewParams, {
    query: { queryKey: getGetAutoAcceptPreviewQueryKey(previewParams) },
  });
  const thresholdCount = autoAcceptPreview
    ? autoAcceptPreview[threshold as "high" | "medium" | "low"]
    : undefined;

  const { data: mappingData, isLoading } = useGetMappingReview({
    search: search || undefined,
    competitor: competitor !== "all" ? competitor : undefined,
    confidence: confidence !== "all" ? confidence : undefined,
    page,
    pageSize: PAGE_SIZE
  }, {
    query: {
      queryKey: getGetMappingReviewQueryKey({
        search: search || undefined,
        competitor: competitor !== "all" ? competitor : undefined,
        confidence: confidence !== "all" ? confidence : undefined,
        page,
        pageSize: PAGE_SIZE
      })
    }
  });

  const updateMapping = useUpdateCompetitorMapping();

  const handleRowChange = (id: number, field: 'code' | 'status', value: string) => {
    setEditingRows(prev => {
      const existing = prev[id] || { 
        code: mappingData?.rows.find(r => r.id === id)?.matchedPrayagCode || "", 
        status: mappingData?.rows.find(r => r.id === id)?.matchStatus || "no match (review)"
      };
      return {
        ...prev,
        [id]: { ...existing, [field]: value }
      };
    });
  };

  const persistMapping = (id: number, code: string, status: string) => {
    updateMapping.mutate({
      id,
      data: {
        matchedPrayagCode: code || null,
        matchStatus: status
      }
    }, {
      onSuccess: () => {
        toast({
          title: "Mapping saved",
          description: "Competitor mapping updated successfully."
        });
        
        // Clean up editing state
        setEditingRows(prev => {
          const next = { ...prev };
          delete next[id];
          return next;
        });

        // Invalidate relevant queries
        queryClient.invalidateQueries({ queryKey: getGetMappingReviewQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetComparisonQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetComparisonSummaryQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetComparisonFiltersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAutoAcceptPreviewQueryKey() });
      },
      onError: (err: any) => {
        toast({
          title: "Save failed",
          description: err.message || "Failed to update mapping.",
          variant: "destructive"
        });
      }
    });
  };

  const handleSave = (id: number) => {
    const edit = editingRows[id];
    if (!edit) return;
    persistMapping(id, edit.code, edit.status);
  };

  const handleAcceptSuggestion = (id: number, code: string) => {
    persistMapping(id, code, "matched");
  };

  const bulkUpdate = useBulkUpdateCompetitorMappings();
  const autoAccept = useAutoAcceptMappings();
  const recordBatch = useRecordAcceptBatch();
  const deleteBatch = useDeleteAcceptBatch();
  const bulkBusy = bulkUpdate.isPending || autoAccept.isPending;

  // Persisted record of recent accept batches, so a reviewer can still revert
  // one after dismissing the success toast or leaving the page.
  const { data: batchData } = useGetAcceptBatches({
    query: { queryKey: getGetAcceptBatchesQueryKey() },
  });
  const recentBatches = batchData?.batches ?? [];

  const invalidateBatches = () =>
    queryClient.invalidateQueries({ queryKey: getGetAcceptBatchesQueryKey() });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getGetMappingReviewQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetComparisonQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetComparisonSummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetComparisonFiltersQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetAutoAcceptPreviewQueryKey() });
  };

  // Persist a freshly accepted batch, then surface an Undo toast tied to it. If
  // recording fails the accept still stands, so we fall back to an id-only undo.
  const recordAndToast = (
    kind: "bulk" | "auto",
    ids: number[],
    title: string,
    description: string,
  ) => {
    if (ids.length === 0) {
      toast({ title, description });
      return;
    }
    const competitorLabel = competitor !== "all" ? competitor : null;
    recordBatch.mutate(
      { data: { kind, ids, competitor: competitorLabel } },
      {
        onSuccess: (batch) => {
          invalidateBatches();
          toast({
            title,
            description,
            action: (
              <ToastAction
                altText="Undo this accept batch"
                onClick={() => revertBatch(ids, batch.id)}
              >
                Undo
              </ToastAction>
            ),
          });
        },
        onError: () => {
          toast({
            title,
            description,
            action: (
              <ToastAction altText="Undo this accept batch" onClick={() => revertBatch(ids)}>
                Undo
              </ToastAction>
            ),
          });
        },
      },
    );
  };

  // Revert an accepted batch back to "no match (review)" with cleared
  // code/confidence, reusing the same bulk PATCH route as the accept paths. When
  // a batchId is given, forget the persisted batch once the revert lands.
  const revertBatch = (ids: number[], batchId?: number) => {
    if (ids.length === 0) return;
    bulkUpdate.mutate(
      {
        data: {
          updates: ids.map((id) => ({
            id,
            matchedPrayagCode: null,
            matchStatus: "no match (review)",
          })),
        },
      },
      {
        onSuccess: (res) => {
          toast({
            title: "Batch reverted",
            description: `Sent ${res.updated} row${res.updated === 1 ? "" : "s"} back to review.`,
          });
          setSelected(new Set());
          setEditingRows({});
          invalidateAll();
          if (batchId != null) {
            deleteBatch.mutate(
              { id: batchId },
              { onSuccess: invalidateBatches, onError: invalidateBatches },
            );
          } else {
            invalidateBatches();
          }
        },
        onError: (err: any) => {
          toast({
            title: "Undo failed",
            description: err.message || "Failed to revert the batch.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const rows = mappingData?.rows ?? [];

  // Rows on this page that have at least one suggestion can be bulk-accepted.
  const selectableRows = useMemo(
    () => rows.filter((r) => (r.suggestions ?? []).length > 0),
    [rows],
  );
  const allSelected =
    selectableRows.length > 0 &&
    selectableRows.every((r) => selected.has(r.id));

  const toggleRow = (id: number, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleAll = (on: boolean) => {
    setSelected(on ? new Set(selectableRows.map((r) => r.id)) : new Set());
  };

  const acceptSelected = () => {
    const updates = selectableRows
      .filter((r) => selected.has(r.id))
      .map((r) => ({
        id: r.id,
        matchedPrayagCode: r.suggestions![0].itemCode,
        matchStatus: "matched",
      }));
    if (updates.length === 0) return;
    bulkUpdate.mutate(
      { data: { updates } },
      {
        onSuccess: (res) => {
          const acceptedIds = res.rows.map((r) => r.id);
          setSelected(new Set());
          setEditingRows({});
          invalidateAll();
          recordAndToast(
            "bulk",
            acceptedIds,
            "Matches accepted",
            `Matched ${res.updated} row${res.updated === 1 ? "" : "s"} from your selection.`,
          );
        },
        onError: (err: any) => {
          toast({
            title: "Bulk accept failed",
            description: err.message || "Failed to accept selected matches.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const runAutoAccept = () => {
    setConfirmOpen(false);
    autoAccept.mutate(
      {
        data: {
          competitor: competitor !== "all" ? competitor : null,
          confidence: confidence !== "all" ? confidence : null,
          search: search || null,
          minConfidence: threshold as "high" | "medium" | "low",
        },
      },
      {
        onSuccess: (res) => {
          setSelected(new Set());
          setEditingRows({});
          invalidateAll();
          if (res.matched > 0) {
            recordAndToast(
              "auto",
              res.matchedIds,
              "Auto-accept complete",
              `Matched ${res.matched} row${res.matched === 1 ? "" : "s"} at ${THRESHOLD_LABELS[threshold].toLowerCase()} confidence.`,
            );
          } else {
            toast({
              title: "Auto-accept complete",
              description: "No rows met the confidence threshold.",
            });
          }
        },
        onError: (err: any) => {
          toast({
            title: "Auto-accept failed",
            description: err.message || "Failed to auto-accept matches.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const total = mappingData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  const exportUrl = (format: "csv" | "xlsx") => {
    const params = new URLSearchParams({ format });
    if (search) params.set("search", search);
    if (competitor !== "all") params.set("competitor", competitor);
    return `/api/catalog/mapping-review/export?${params.toString()}`;
  };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Mapping Review</h1>
          <p className="text-muted-foreground mt-1">
            Review and map competitor products to Prayag item codes.
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <a href={exportUrl("xlsx")} download>Excel (.xlsx)</a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={exportUrl("csv")} download>CSV (.csv)</a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex gap-4 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            placeholder="Search descriptions, codes..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        
        <Select value={competitor} onValueChange={setCompetitor}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Competitor" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Competitors</SelectItem>
            {(filters?.competitors ?? []).map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={confidence} onValueChange={setConfidence}>
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="Confidence" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Confidence</SelectItem>
            {(filters?.confidences ?? []).map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4 rounded-md border bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Auto-accept</span>
          <Select value={threshold} onValueChange={setThreshold} disabled={bulkBusy}>
            <SelectTrigger className="w-[160px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="high">{THRESHOLD_LABELS.high}</SelectItem>
              <SelectItem value="medium">{THRESHOLD_LABELS.medium}</SelectItem>
              <SelectItem value="low">{THRESHOLD_LABELS.low}</SelectItem>
            </SelectContent>
          </Select>
          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={bulkBusy || total === 0 || thresholdCount === 0}
          >
            <Zap className="w-4 h-4 mr-1.5" />
            {autoAccept.isPending ? "Accepting…" : "Auto-accept all"}
          </Button>
          <span className="text-xs text-muted-foreground">
            {thresholdCount === undefined
              ? `Applies the top suggestion across ${competitor !== "all" ? competitor : "all competitors"} (${total} pending).`
              : `Would match ${thresholdCount} of ${total} pending row${total === 1 ? "" : "s"} across ${competitor !== "all" ? competitor : "all competitors"}.`}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {selected.size} selected
          </span>
          <Button
            variant="secondary"
            onClick={acceptSelected}
            disabled={bulkBusy || selected.size === 0}
          >
            <Check className="w-4 h-4 mr-1.5" />
            {bulkUpdate.isPending ? "Accepting…" : "Accept selected"}
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Auto-accept matches?</AlertDialogTitle>
            <AlertDialogDescription>
              This will accept the top suggestion for{" "}
              <strong>
                {thresholdCount ?? 0} of {total} pending row
                {total === 1 ? "" : "s"}
              </strong>{" "}
              in the current filter whose best match is{" "}
              <strong>{THRESHOLD_LABELS[threshold].toLowerCase()}</strong> confidence.
              You can still re-review any row afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runAutoAccept}>Accept matches</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {recentBatches.length > 0 && (
        <div className="mb-6 rounded-md border bg-muted/20 p-4">
          <div className="mb-3 flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">Recent accept batches</h2>
            <span className="text-xs text-muted-foreground">
              Sent matches back to review even after the toast is gone.
            </span>
          </div>
          <ul className="space-y-2">
            {recentBatches.map((batch) => (
              <li
                key={batch.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-card px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant={batch.kind === "auto" ? "default" : "secondary"}>
                    {batch.kind === "auto" ? "Auto-accept" : "Accept selected"}
                  </Badge>
                  <span className="font-medium">
                    {batch.count} row{batch.count === 1 ? "" : "s"}
                  </span>
                  {batch.competitor && (
                    <span className="text-muted-foreground">· {batch.competitor}</span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    · {formatBatchTime(batch.createdAt)}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={bulkBusy}
                  onClick={() => revertBatch(batch.competitorPriceIds, batch.id)}
                >
                  <Undo2 className="mr-1.5 h-4 w-4" />
                  Send back to review
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="border rounded-md bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 w-10">
                  <Checkbox
                    checked={allSelected}
                    disabled={selectableRows.length === 0 || bulkBusy}
                    onCheckedChange={(v) => toggleAll(v === true)}
                    aria-label="Select all suggestible rows on this page"
                  />
                </th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Competitor</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Category</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Description</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Size</th>
                <th className="px-4 py-3 font-medium text-muted-foreground text-right">Price</th>
                <th className="px-4 py-3 font-medium text-muted-foreground w-28">Confidence</th>
                <th className="px-4 py-3 font-medium text-muted-foreground w-48">Prayag Code</th>
                <th className="px-4 py-3 font-medium text-muted-foreground w-40">Status</th>
                <th className="px-4 py-3 font-medium text-muted-foreground w-20"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">Loading pending reviews...</td>
                </tr>
              ) : mappingData?.rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">No reviews pending.</td>
                </tr>
              ) : (
                mappingData?.rows.map((row) => {
                  const editState = editingRows[row.id];
                  const codeVal = editState?.code ?? (row.matchedPrayagCode || "");
                  const statusVal = editState?.status ?? (row.matchStatus || "no match (review)");
                  const hasChanges = editState !== undefined;
                  const invalidMatch = statusVal === "matched" && !codeVal.trim();
                  const suggestions = row.suggestions ?? [];

                  return (
                    <Fragment key={row.id}>
                    <tr className={`hover:bg-muted/50 transition-colors ${suggestions.length > 0 ? "" : "border-b last:border-0"} ${selected.has(row.id) ? "bg-primary/5" : ""}`}>
                      <td className="px-4 py-3">
                        <Checkbox
                          checked={selected.has(row.id)}
                          disabled={suggestions.length === 0 || bulkBusy}
                          onCheckedChange={(v) => toggleRow(row.id, v === true)}
                          aria-label={`Select ${row.competitor} row`}
                        />
                      </td>
                      <td className="px-4 py-3 font-medium">{row.competitor}</td>
                      <td className="px-4 py-3 text-muted-foreground">{row.category || "-"}</td>
                      <td className="px-4 py-3 max-w-[250px] truncate" title={row.description || ""}>
                        {row.description || "-"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{row.size || "-"}</td>
                      <td className="px-4 py-3 text-right font-mono">
                        {row.price == null ? "—" : `₹${row.price.toFixed(2)}`}
                        {row.unit && <span className="text-xs text-muted-foreground ml-1">/{row.unit}</span>}
                      </td>
                      <td className="px-4 py-3">
                        <ConfidenceBadge confidence={row.matchConfidence} />
                      </td>
                      <td className="px-4 py-3">
                        <Input 
                          size={1}
                          className={cn("h-8 font-mono uppercase", invalidMatch && "border-destructive focus-visible:ring-destructive")}
                          value={codeVal}
                          onChange={(e) => handleRowChange(row.id, 'code', e.target.value)}
                          placeholder="Code..."
                        />
                        {invalidMatch && (
                          <div className="text-[10px] text-destructive mt-1">Enter a code to mark matched</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Select 
                          value={statusVal} 
                          onValueChange={(v) => handleRowChange(row.id, 'status', v)}
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="matched">Matched</SelectItem>
                            <SelectItem value="no match (review)">Needs Review</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button 
                          size="sm" 
                          disabled={!hasChanges || invalidMatch || updateMapping.isPending}
                          onClick={() => handleSave(row.id)}
                          variant={hasChanges ? "default" : "secondary"}
                        >
                          <Save className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                    {suggestions.length > 0 && (
                      <tr className="border-b last:border-0 bg-muted/20">
                        <td colSpan={5}></td>
                        <td colSpan={5} className="px-4 pb-3 pt-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                              <Sparkles className="w-3.5 h-3.5" />
                              Suggested:
                            </span>
                            {suggestions.map((s) => (
                              <button
                                key={s.itemCode}
                                type="button"
                                disabled={updateMapping.isPending}
                                onClick={() => handleAcceptSuggestion(row.id, s.itemCode)}
                                title={[
                                  s.productName,
                                  s.category,
                                  s.size,
                                  s.currentMrp != null ? `MRP ₹${s.currentMrp.toFixed(2)}` : null,
                                ].filter(Boolean).join(" · ")}
                                className="group flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs transition-colors hover:border-primary hover:bg-primary/5 disabled:opacity-50"
                              >
                                <Check className="w-3 h-3 text-muted-foreground group-hover:text-primary" />
                                <span className="font-mono font-medium uppercase">{s.itemCode}</span>
                                {s.productName && (
                                  <span className="max-w-[180px] truncate text-muted-foreground">
                                    {s.productName}
                                  </span>
                                )}
                                <Badge
                                  variant={
                                    s.confidenceLabel === "high"
                                      ? "default"
                                      : s.confidenceLabel === "medium"
                                        ? "secondary"
                                        : "outline"
                                  }
                                  className="ml-0.5 px-1.5 py-0 text-[10px]"
                                >
                                  {s.confidence}%
                                </Badge>
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between mt-4">
        <p className="text-sm text-muted-foreground font-mono">
          {total === 0 ? "0 results" : `${rangeStart}–${rangeEnd} of ${total}`}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || isLoading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground font-mono px-2">
            Page {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages || isLoading}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
}
