import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Download, FileSpreadsheet, Upload } from "lucide-react";
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

  const handleDownloadUnmatched = () => {
    if (!result?.unmatchedCodes?.length) return;
    const lines = ["Item Code", ...result.unmatchedCodes].join("\n");
    const blob = new Blob([lines], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "unmatched-codes.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const nothingImported =
    result &&
    result.matchedProducts === 0 &&
    result.newProducts === 0 &&
    result.totalRows === 0;

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

          {/* Detection details */}
          <div className="text-sm grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="bg-muted/40 rounded px-3 py-2">
              <span className="text-muted-foreground">Code column: </span>
              <span className="font-medium">
                {result.codeColHeader ? (
                  <code className="bg-muted px-1 rounded">{result.codeColHeader}</code>
                ) : (
                  <span className="text-destructive">Not detected</span>
                )}
              </span>
            </div>
            <div className="bg-muted/40 rounded px-3 py-2">
              <span className="text-muted-foreground">Price column: </span>
              <span className="font-medium">
                {result.priceColHeader ? (
                  <code className="bg-muted px-1 rounded">{result.priceColHeader}</code>
                ) : (
                  <span className="text-destructive">Not detected</span>
                )}
              </span>
            </div>
            <div className="bg-muted/40 rounded px-3 py-2">
              <span className="text-muted-foreground">Basis: </span>
              <span className="font-medium">{result.basis || "—"}</span>
            </div>
          </div>

          {/* Counts */}
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

          {/* Zero-import warning */}
          {nothingImported && (
            <div className="flex items-start gap-3 text-sm text-amber-800 bg-amber-50 border border-amber-300 p-3 rounded">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
              <div>
                <p className="font-semibold">No valid code-and-price rows could be read from this file.</p>
                {!result.codeColHeader && (
                  <p className="mt-1">No item-code column was found. Make sure the sheet has a header row with a column labelled "Code", "Item Code", or similar.</p>
                )}
                {result.codeColHeader && !result.priceColHeader && (
                  <p className="mt-1">A code column was found but no price column was detected. Make sure a column header contains "MRP", "Price", "Rate", or "Net".</p>
                )}
                {result.codeColHeader && result.priceColHeader && (
                  <p className="mt-1">Both columns were detected but no rows had a valid code and a positive price together.</p>
                )}
                {result.skippedUnparseable > 0 && (
                  <p className="mt-1">{result.skippedUnparseable} row{result.skippedUnparseable !== 1 ? "s" : ""} had a blank or unreadable code, or an invalid price.</p>
                )}
              </div>
            </div>
          )}

          {/* Skipped duplicates */}
          {result.skippedDuplicates > 0 && (
            <div className="text-sm text-amber-600 bg-amber-50 p-3 rounded border border-amber-200">
              Skipped {result.skippedDuplicates} rows that matched existing prices for this date.
            </div>
          )}

          {/* Rows skipped due to bad codes / prices (non-zero-import case) */}
          {!nothingImported && result.skippedUnparseable > 0 && (
            <div className="text-sm text-amber-600 bg-amber-50 p-3 rounded border border-amber-200">
              {result.skippedUnparseable} row{result.skippedUnparseable !== 1 ? "s were" : " was"} skipped — item code could not be parsed or price was invalid.
            </div>
          )}

          {/* Download unmatched */}
          {result.unmatchedCodes?.length > 0 && (
            <div className="flex items-center justify-between text-sm bg-muted/40 border rounded px-3 py-2">
              <span className="text-muted-foreground">
                {result.unmatchedCodes.length} code{result.unmatchedCodes.length !== 1 ? "s" : ""} not found in the existing catalog (added as new products)
              </span>
              <button
                onClick={handleDownloadUnmatched}
                className="flex items-center gap-1.5 text-primary hover:underline font-medium ml-4 shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                Download unmatched rows
              </button>
            </div>
          )}

          {/* General message */}
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
