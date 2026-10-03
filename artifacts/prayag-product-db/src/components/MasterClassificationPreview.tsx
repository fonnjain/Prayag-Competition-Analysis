import { Button } from "@/components/ui/button";
import { formatCount } from "@workspace/formatting";

type Classification = { division: string | null; category: string | null; seriesRange: string | null };
type Difference = {
  itemCode: string; message: string; differingFields: string[];
  stored: Classification;
  file: Classification & { categoryProvided: boolean; rangeProvided: boolean };
};

export function MasterClassificationPreview({ counts, differences, policy, lifecyclePolicy }: {
  counts: { existingProducts: number; newNonRangeProducts: number; refusedNewRangeProducts: number };
  differences: Difference[]; policy?: string; lifecyclePolicy?: string;
}) {
  function download() {
    const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = [
      ["item_code", "message", "differing_fields", "stored_division", "file_division", "stored_category", "file_category", "category_provided", "stored_series_range", "file_series_range", "range_provided"],
      ...differences.map(row => [row.itemCode, row.message, row.differingFields.join("; "), row.stored.division, row.file.division, row.stored.category, row.file.category, row.file.categoryProvided, row.stored.seriesRange, row.file.seriesRange, row.file.rangeProvided]),
    ];
    const url = URL.createObjectURL(new Blob(["\uFEFF" + rows.map(row => row.map(quote).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = "master-classification-differs-not-changed.csv"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="space-y-3 rounded border p-4">
    <h3 className="font-medium">Master classification — existing products are prices only</h3>
    <p className="text-sm text-muted-foreground">{policy}</p>
    <p className="text-sm text-muted-foreground">{lifecyclePolicy}</p>
    <div className="grid gap-3 sm:grid-cols-3">{[
      ["Existing products — prices only", counts.existingProducts],
      ["New non-Range products", counts.newNonRangeProducts],
      ["New CP/PTMT products refused", counts.refusedNewRangeProducts],
    ].map(([label, value]) => <div key={label} className="rounded bg-muted/50 p-3"><div className="text-xs text-muted-foreground">{label}</div><strong className="font-mono text-xl">{formatCount(Number(value))}</strong></div>)}</div>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <strong className="text-sm">classification differs — not changed ({formatCount(differences.length)})</strong>
      <Button variant="outline" size="sm" onClick={download}>Download all differences</Button>
    </div>
    {differences.length > 0 && <details><summary className="cursor-pointer text-sm">Show every classification difference</summary>
      <div className="mt-2 max-h-96 overflow-auto"><table className="w-full text-left text-xs">
        <thead><tr><th className="p-2">Code / fields</th><th className="p-2">Stored — kept</th><th className="p-2">File — not applied</th></tr></thead>
        <tbody>{differences.map(row => <tr key={row.itemCode} className="border-t">
          <td className="p-2 font-mono">{row.itemCode}<br />{row.differingFields.join(", ")}</td>
          <td className="p-2">Division: {row.stored.division ?? "—"}<br />Category: {row.stored.category ?? "—"}<br />Range: {row.stored.seriesRange ?? "—"}</td>
          <td className="p-2">Division: {row.file.division}<br />Category: {row.file.categoryProvided ? row.file.category ?? "—" : "not supplied — kept"}<br />Range: {row.file.rangeProvided ? row.file.seriesRange ?? "—" : "not supplied — hidden value kept"}</td>
        </tr>)}</tbody>
      </table></div>
    </details>}
  </section>;
}