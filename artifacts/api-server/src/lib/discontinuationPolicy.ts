/**
 * A catalogue code may occur in several source ranges. It is discontinued only
 * when every source occurrence is marked REMOVED; one live occurrence keeps the
 * shared component live.
 */
export interface SourceRemovalRow {
  itemCode: string;
  discontinuedFrom: string | null;
  isRemoved: boolean;
}

export interface ConfirmedDiscontinuation {
  itemCode: string;
  discontinuedFrom: string;
}

export function deriveConfirmedDiscontinuations(
  rows: SourceRemovalRow[],
): ConfirmedDiscontinuation[] {
  const byCode = new Map<
    string,
    { itemCode: string; allRemoved: boolean; dates: Set<string> }
  >();

  for (const row of rows) {
    const itemCode = row.itemCode.trim();
    if (!itemCode) continue;
    const key = itemCode.toUpperCase();
    const group = byCode.get(key) ?? {
      itemCode,
      allRemoved: true,
      dates: new Set<string>(),
    };
    group.allRemoved &&= row.isRemoved;
    if (row.discontinuedFrom) group.dates.add(row.discontinuedFrom);
    byCode.set(key, group);
  }

  return [...byCode.values()]
    .filter((group) => group.allRemoved && group.dates.size > 0)
    .map((group) => ({
      itemCode: group.itemCode,
      // A source code can be present in multiple ranges. If all are removed at
      // different revisions, the first withdrawal is the effective stop date.
      discontinuedFrom: [...group.dates].sort()[0]!,
    }))
    .sort((a, b) => a.itemCode.localeCompare(b.itemCode));
}