import { useState, useEffect, Fragment } from "react";
import { 
  useGetMappingReview,
  useUpdateCompetitorMapping,
  useGetComparisonFilters,
  getGetMappingReviewQueryKey,
  getGetComparisonQueryKey,
  getGetComparisonSummaryQueryKey,
  getGetComparisonFiltersQueryKey
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, ChevronLeft, ChevronRight, Save, Sparkles, Check } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

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

  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    setPage(1);
  }, [search, competitor, confidence]);

  const { data: filters } = useGetComparisonFilters();

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

  const total = mappingData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Mapping Review</h1>
        <p className="text-muted-foreground mt-1">
          Review and map competitor products to Prayag item codes.
        </p>
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

      <div className="border rounded-md bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b bg-muted/50">
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
                  <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">Loading pending reviews...</td>
                </tr>
              ) : mappingData?.rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">No reviews pending.</td>
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
                    <tr className={`hover:bg-muted/50 transition-colors ${suggestions.length > 0 ? "" : "border-b last:border-0"}`}>
                      <td className="px-4 py-3 font-medium">{row.competitor}</td>
                      <td className="px-4 py-3 text-muted-foreground">{row.category || "-"}</td>
                      <td className="px-4 py-3 max-w-[250px] truncate" title={row.description || ""}>
                        {row.description || "-"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{row.size || "-"}</td>
                      <td className="px-4 py-3 text-right font-mono">
                        ₹{row.price.toFixed(2)}
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
                        <td colSpan={4}></td>
                        <td colSpan={4} className="px-4 pb-3 pt-0">
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
