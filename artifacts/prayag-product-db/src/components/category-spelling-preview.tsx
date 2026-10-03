import type { CategorySpellingDecision } from "@workspace/api-client-react";

export function CategorySpellingPreview({ decisions }: { decisions?: CategorySpellingDecision[] }) {
  if (!decisions?.length) return null;
  return <details className="rounded-lg border bg-background p-4" open data-testid="category-spelling-preview">
    <summary className="cursor-pointer font-semibold">Category spelling check ({decisions.length})</summary>
    <p className="mt-2 text-sm text-muted-foreground">New products only for loads. Existing products keep their Category, Range and division.
      A new Category needs the normal administrator approval. No spelling merge is performed.</p>
    <div className="mt-3 max-h-96 overflow-auto"><table className="w-full min-w-[650px] text-left text-sm">
      <thead><tr className="border-b"><th className="p-2">Product / Division</th><th className="p-2">Input</th><th className="p-2">Will write</th><th className="p-2">Decision / existing spellings</th></tr></thead>
      <tbody>{decisions.map((row, index) => <tr key={`${row.itemCode ?? ""}-${index}`} className="border-b">
        <td className="p-2">{row.itemCode}<br />{row.division ?? "Unassigned"}</td>
        <td className="p-2 font-mono">{JSON.stringify(row.inputCategory)}</td>
        <td className="p-2 font-mono">{row.selectedCategory === null ? "None — review required" : JSON.stringify(row.selectedCategory)}</td>
        <td className="p-2"><strong>{row.status}</strong><p className="text-xs">{row.selectionReason}</p>
          {row.candidates.map(candidate => <p key={candidate.category} className="text-xs"><code>{JSON.stringify(candidate.category)}</code>: {candidate.activeProducts} active products</p>)}</td>
      </tr>)}</tbody>
    </table></div>
  </details>;
}