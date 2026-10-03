import { useState } from "react";
import { checkCatalogCategorySpelling, type CategorySpellingDecision } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CategorySpellingPreview } from "./category-spelling-preview";

export function ReadOnlyCategoryCheck({ division }: { division: string }) {
  const [category, setCategory] = useState("");
  const [result, setResult] = useState<{ division: string; input: string; decision: CategorySpellingDecision } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function check() {
    setBusy(true);
    setError("");
    setResult(null);
    const input = category.trim();
    try {
      const decision = await checkCatalogCategorySpelling({ division, category: input });
      setResult({ division, input, decision });
    } catch {
      setError("Could not check the Category spelling. Administrator access is required.");
    } finally {
      setBusy(false);
    }
  }
  return <section className="rounded-lg border p-4 space-y-3" aria-label="Read-only Category check">
    <div>
      <h3 className="font-semibold">Read-only Category spelling check</h3>
      <p className="text-sm text-muted-foreground">Select a division in the form below, then check any typed Category. This creates no category, product, token or batch.</p>
      <p className="text-sm">Division: <strong>{division || "Select a division below"}</strong></p>
    </div>
    <div className="flex flex-wrap gap-2">
      <Input className="min-w-0 flex-1" aria-label="Category to check" data-testid="input-readonly-category" value={category}
        onChange={e => { setCategory(e.target.value); setResult(null); setError(""); }}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (division && category.trim() && !busy) void check(); } }} />
      <Button type="button" data-testid="button-readonly-category-check" disabled={!division || !category.trim() || busy} onClick={() => void check()}>
        {busy ? "Checking…" : "Check spelling — no save"}
      </Button>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {result && result.division === division && result.input === category.trim() &&
      <CategorySpellingPreview decisions={[result.decision]} />}
  </section>;
}