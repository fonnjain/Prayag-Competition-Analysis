import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { FileSpreadsheet, Upload } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetCatalogProductsQueryKey,
  getGetCatalogDataHealthQueryKey,
  getGetCatalogFiltersQueryKey,
} from "@workspace/api-client-react";

export default function LoadMrpPage() {
  const [file, setFile] = useState<File | null>(null);
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().split('T')[0]);
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !effectiveDate) return;

    setIsUploading(true);
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("effectiveDate", effectiveDate);

    try {
      const res = await fetch("/api/catalog/load-mrp", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to upload file");
      }

      setResult(data.results);
      toast({
        title: "Upload Successful",
        description: `Imported ${data.results.totalRows} rows successfully.`,
      });
      
      // Invalidate catalog queries so new prices/products show immediately.
      queryClient.invalidateQueries({ queryKey: getGetCatalogProductsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetCatalogDataHealthQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetCatalogFiltersQueryKey() });

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
        <h1 className="text-3xl font-bold tracking-tight">Load MRP Sheet</h1>
        <p className="text-muted-foreground mt-2">
          Upload a new price sheet to append to the historical ledger. Old prices are never overwritten.
        </p>
      </div>

      <div className="bg-card border rounded-lg p-6">
        <form onSubmit={handleUpload} className="space-y-6">
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
          
          <div className="space-y-2">
            <Label htmlFor="effectiveDate">Effective Date</Label>
            <Input 
              id="effectiveDate" 
              type="date" 
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              required
            />
          </div>

          <Button type="submit" disabled={!file || !effectiveDate || isUploading} className="w-full">
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
            <FileSpreadsheet className="w-5 h-5 text-primary" />
            Import Summary
          </h3>
          
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="p-4 bg-muted/50 rounded-md">
              <div className="text-sm text-muted-foreground mb-1">Total Rows</div>
              <div className="text-2xl font-mono font-bold">{result.totalRows}</div>
            </div>
            <div className="p-4 bg-muted/50 rounded-md">
              <div className="text-sm text-muted-foreground mb-1">Matched</div>
              <div className="text-2xl font-mono font-bold text-green-600">{result.matchedProducts}</div>
            </div>
            <div className="p-4 bg-muted/50 rounded-md">
              <div className="text-sm text-muted-foreground mb-1">New Products</div>
              <div className="text-2xl font-mono font-bold">{result.newProducts}</div>
            </div>
            <div className="p-4 bg-muted/50 rounded-md">
              <div className="text-sm text-muted-foreground mb-1">New Prices</div>
              <div className="text-2xl font-mono font-bold text-primary">{result.newHistoryRows}</div>
            </div>
          </div>
          
          {result.skippedDuplicates > 0 && (
            <div className="text-sm text-amber-600 bg-amber-50 p-3 rounded border border-amber-200">
              Skipped {result.skippedDuplicates} rows that matched existing prices for this date.
            </div>
          )}
          
          {result.message && (
            <div className="text-sm text-muted-foreground bg-muted p-3 rounded">
              {result.message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
