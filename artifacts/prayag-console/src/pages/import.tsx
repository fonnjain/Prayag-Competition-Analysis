import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";

export default function ImportPage() {
  const [isUploading, setIsUploading] = useState(false);
  const [results, setResults] = useState<any[] | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    
    setIsUploading(true);
    const formData = new FormData();
    for (let i = 0; i < e.target.files.length; i++) {
      formData.append("files", e.target.files[i]);
    }

    try {
      const res = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/import`, {
        method: "POST",
        body: formData,
      });
      
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.message || "Failed to import");
      
      setResults(data.results);
      toast({
        title: "Import Successful",
        description: data.message,
      });
      
      // Invalidate queries to refresh data
      queryClient.invalidateQueries();
    } catch (err: any) {
      toast({
        title: "Import Failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      // reset file input
      e.target.value = "";
    }
  };

  return (
    <div className="flex-1 p-6 space-y-6 max-w-4xl mx-auto w-full">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Import Data</h2>
        <p className="text-muted-foreground">Upload competitor pricing sheets (Excel/PDF) to update the matrix.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upload Files</CardTitle>
          <CardDescription>Select one or more files to import.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border-2 border-dashed border-border rounded-lg p-12 text-center hover:bg-muted/50 transition-colors">
            <Upload className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <div className="mt-4 flex text-sm leading-6 text-muted-foreground justify-center">
              <label htmlFor="file-upload" className="relative cursor-pointer rounded-md bg-background font-semibold text-primary focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 hover:text-primary/80">
                <span>Upload a file</span>
                <input id="file-upload" name="file-upload" type="file" multiple className="sr-only" onChange={handleFileChange} disabled={isUploading} accept=".xlsx,.xls,.pdf" />
              </label>
              <p className="pl-1">or drag and drop</p>
            </div>
            <p className="text-xs leading-5 text-muted-foreground mt-2">XLSX, XLS, PDF up to 10MB</p>
          </div>

          {isUploading && <div className="mt-4 text-center text-sm">Uploading and processing...</div>}

          {results && (
            <div className="mt-8 space-y-4">
              <h3 className="font-semibold text-lg">Import Results</h3>
              {results.map((r, i) => (
                <div key={i} className="p-4 bg-muted rounded-md text-sm space-y-1">
                  <p><strong>File:</strong> {r.fileName}</p>
                  <p><strong>Detected Brand:</strong> {r.competitor} ({r.basis})</p>
                  <p className="text-success"><strong>Matched:</strong> {r.matchedByCode + r.matchedByName} / {r.total}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
