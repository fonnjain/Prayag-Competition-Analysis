import { useState, useEffect } from "react";
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
import { Search, ChevronLeft, ChevronRight, Save } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const PAGE_SIZE = 50;

export default function MappingReviewPage() {
  const [search, setSearch] = useState("");
  const [competitor, setCompetitor] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [editingRows, setEditingRows] = useState<Record<number, { code: string, status: string }>>({});

  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    setPage(1);
  }, [search, competitor]);

  const { data: filters } = useGetComparisonFilters();

  const { data: mappingData, isLoading } = useGetMappingReview({
    search: search || undefined,
    competitor: competitor !== "all" ? competitor : undefined,
    page,
    pageSize: PAGE_SIZE
  }, {
    query: {
      queryKey: getGetMappingReviewQueryKey({
        search: search || undefined,
        competitor: competitor !== "all" ? competitor : undefined,
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

  const handleSave = (id: number) => {
    const edit = editingRows[id];
    if (!edit) return;

    updateMapping.mutate({
      id,
      data: {
        matchedPrayagCode: edit.code || null,
        matchStatus: edit.status
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
                <th className="px-4 py-3 font-medium text-muted-foreground w-48">Prayag Code</th>
                <th className="px-4 py-3 font-medium text-muted-foreground w-40">Status</th>
                <th className="px-4 py-3 font-medium text-muted-foreground w-20"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">Loading pending reviews...</td>
                </tr>
              ) : mappingData?.rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No reviews pending.</td>
                </tr>
              ) : (
                mappingData?.rows.map((row) => {
                  const editState = editingRows[row.id];
                  const codeVal = editState?.code ?? (row.matchedPrayagCode || "");
                  const statusVal = editState?.status ?? (row.matchStatus || "no match (review)");
                  const hasChanges = editState !== undefined;

                  return (
                    <tr key={row.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
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
                        <Input 
                          size={1}
                          className="h-8 font-mono uppercase" 
                          value={codeVal}
                          onChange={(e) => handleRowChange(row.id, 'code', e.target.value)}
                          placeholder="Code..."
                        />
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
                          disabled={!hasChanges || updateMapping.isPending}
                          onClick={() => handleSave(row.id)}
                          variant={hasChanges ? "default" : "secondary"}
                        >
                          <Save className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
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
