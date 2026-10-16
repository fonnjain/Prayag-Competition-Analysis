import type { DivisionCatalogueState } from "@workspace/api-client-react";

function OutsideDivisions({ state, before = false, restored = false }: {
  state: DivisionCatalogueState; before?: boolean; restored?: boolean;
}) {
  if (!state.outsideDivisionProducts) return null;
  return <section role={before ? undefined : "alert"} className="space-y-2 rounded-lg border border-amber-400 bg-amber-50 p-4 text-amber-950 dark:bg-amber-950 dark:text-amber-100">
    <p className="font-semibold">{before ? "Before this operation: " : "⚠ "}
      {state.outsideDivisionProducts} products sit in divisions outside the seven:{" "}
      {state.outsideDivisions.map(g => `${g.division ?? "(blank)"} (${g.count})`).join(", ")}.
    </p>
    <p>{before ? "Original catalogue values, including any composites, are disclosed below."
      : restored ? "Undo restored the recorded original divisions, including any composites. These rows still need separate attention."
      : "This operation did not create them and does not change them. They need separate attention."}</p>
    <ul className="space-y-2 text-sm">{state.outsideDivisions.map(g => <li key={g.division ?? "__null__"}>
      <strong>{g.division ?? "(blank)"} ({g.count}): </strong>
      <span className="break-words font-mono">{g.itemCodes.join(", ")}</span>
    </li>)}</ul>
  </section>;
}

export function DivisionCatalogueDisclosure({ before, after, projected = false, restored = false }: {
  before: DivisionCatalogueState; after: DivisionCatalogueState; projected?: boolean; restored?: boolean;
}) {
  const divisions = [...new Set([...Object.keys(before.counts), ...Object.keys(after.counts)])].sort();
  return <section className="space-y-4">
    <OutsideDivisions state={after} restored={restored} />
    <h3 className="font-semibold">Whole-catalogue disclosure — not an Apply acceptance test</h3>
    <p className="text-sm">Distinct divisions: {before.distinctDivisions} before → {after.distinctDivisions} {projected ? "projected after" : "after"}.
      {" "}Composite products: {before.compositeProducts} before → {after.compositeProducts} {projected ? "projected remaining" : "remaining"}.</p>
    {after.composites.length > 0 && <p className="text-sm font-semibold">Composite values remaining: {after.composites.map(g => `${g.division} (${g.count})`).join("; ")}</p>}
    <div className="overflow-auto"><table className="w-full text-left text-sm">
      <thead><tr><th>Division</th><th>Before</th><th>{projected ? "Projected after" : "After"}</th></tr></thead>
      <tbody>{divisions.map(d => <tr key={d} className="border-t"><td className="p-2">{d}</td><td>{before.counts[d] ?? 0}</td><td>{after.counts[d] ?? 0}</td></tr>)}</tbody>
    </table></div>
    <OutsideDivisions state={before} before />
  </section>;
}
