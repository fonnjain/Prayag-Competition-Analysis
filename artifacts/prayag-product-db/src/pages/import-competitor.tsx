import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { FileUp, Upload, Trash2, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetComparisonFilters,
  useDeleteCatalogCompetitor,
  getGetComparisonQueryKey,
  getGetComparisonByProductQueryKey,
  getGetComparisonSummaryQueryKey,
  getGetComparisonFiltersQueryKey,
  getGetComparisonMatrixQueryKey,
  getGetMappingReviewQueryKey,
} from "@workspace/api-client-react";
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

export default function ImportCompetitorPage() {
  const [file, setFile] = useState<File | null>(null);
  const [competitor, setCompetitor] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: filters } = useGetComparisonFilters();
  const competitors = filters?.competitors ?? [];

  const invalidateComparisonQueries = () => {
    queryClient.invalidateQueries({ queryKey: getGetComparisonQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetComparisonByProductQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetComparisonSummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetComparisonFiltersQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetComparisonMatrixQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetMappingReviewQueryKey() });
  };

  const deleteMutation = useDeleteCatalogCompetitor({
    mutation: {
      onSuccess: (data) => {
        toast({
          title: "Brand Removed",
          description: `Deleted ${data.deleted} price rows for ${data.competitor}.`,
        });
        invalidateComparisonQueries();
      },
      onError: (err: any) => {
        toast({
          title: "Delete Failed",
          description: err?.message || "Could not remove competitor brand.",
          variant: "destructive",
        });
      },
    },
  });

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !competitor.trim()) return;

    setIsUploading(true);
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("competitor", competitor.trim());

    try {
      const res = await fetch("/api/catalog/load-competitor", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to upload competitor file");
      }

      setResult(data.results);
      toast({
        title: "Upload Successful",
        description: `Imported ${data.results.inserted} rows for ${data.results.competitor}.`,
      });

      invalidateComparisonQueries();

      // Reset file input
      setFile(null);
      const fileInput = document.getElementById('file') as HTMLInputElement;
      if (fileInput) fileInput.value = '';

    } catch (err: any) {
      toast({
        title: "Upload Failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Import Competitor Data</h1>
        <p className="text-muted-foreground mt-2">
          Upload a competitor price list to compare against Prayag's catalog.
        </p>
      </div>

      <div className="bg-card border rounded-lg p-6">
        <form onSubmit={handleUpload} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="competitor">Competitor Brand Name</Label>
            <Input 
              id="competitor" 
              type="text" 
              placeholder="e.g. Prince, Astral, Ashirvad"
              value={competitor}
              onChange={(e) => setCompetitor(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="file">Price Sheet (Excel/CSV)</Label>
            <Input 
              id="file" 
              type="file" 
              accept=".xlsx,.xls,.csv" 
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              required
            />
          </div>

          <Button type="submit" disabled={!file || !competitor.trim() || isUploading} className="w-full">
            {isUploading ? (
              "Uploading..."
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                Process Upload
              </>
            )}
          </Button>
        </form>
      </div>

      {result && (
        <div className="bg-card border rounded-lg p-6 space-y-4">
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <FileUp className="w-5 h-5 text-primary" />
            Import Summary: {result.competitor}
          </h3>
          
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="p-4 bg-muted/50 rounded-md">
              <div className="text-sm text-muted-foreground mb-1">Total Rows</div>
              <div className="text-2xl font-mono font-bold">{result.totalRows}</div>
            </div>
            <div className="p-4 bg-muted/50 rounded-md">
              <div className="text-sm text-muted-foreground mb-1">Inserted</div>
              <div className="text-2xl font-mono font-bold text-primary">{result.inserted}</div>
            </div>
            <div className="p-4 bg-muted/50 rounded-md">
              <div className="text-sm text-muted-foreground mb-1">Auto-Matched</div>
              <div className="text-2xl font-mono font-bold text-green-600">{result.matched}</div>
            </div>
            <div className="p-4 bg-muted/50 rounded-md">
              <div className="text-sm text-muted-foreground mb-1">Unmatched</div>
              <div className="text-2xl font-mono font-bold text-amber-600">{result.unmatched}</div>
            </div>
          </div>
          
          {result.unmatched > 0 && (
            <div className="text-sm text-amber-600 bg-amber-50 p-3 rounded border border-amber-200">
              {result.unmatched} rows need human review. Please visit the Mapping Review page to match them.
            </div>
          )}
        </div>
      )}

      <div className="bg-card border rounded-lg p-6 space-y-4">
        <div>
          <h3 className="font-semibold text-lg">Tracked Competitor Brands</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Remove a brand you no longer track. This deletes all of its price rows
            and removes it from the comparison filters, columns, and KPIs.
          </p>
        </div>

        {competitors.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center border border-dashed rounded-md">
            No competitor brands loaded yet. Upload a price sheet above to get started.
          </div>
        ) : (
          <ul className="divide-y border rounded-md">
            {competitors.map((brand) => {
              const isDeleting =
                deleteMutation.isPending &&
                deleteMutation.variables?.competitor === brand;
              return (
                <li
                  key={brand}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <span className="font-medium">{brand}</span>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        disabled={deleteMutation.isPending}
                      >
                        {isDeleting ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4 mr-2" />
                        )}
                        Remove
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove {brand}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This permanently deletes all of {brand}'s price rows.
                          The brand will disappear from the comparison filters,
                          By Product columns, and summary KPIs. This cannot be
                          undone — you would need to re-upload its price sheet to
                          restore it.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={() =>
                            deleteMutation.mutate({ competitor: brand })
                          }
                        >
                          Remove Brand
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
