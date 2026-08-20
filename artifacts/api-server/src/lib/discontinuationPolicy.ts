/**
 * A catalogue code may occur in several source ranges. It is discontinued only
 * when every source occurrence is marked REMOVED; one live occurrence keeps the
 * shared component live.
 */
export interface SourceRemovalRow {
  itemCode: string;
  /** The effective date of the workbook column that contains REMOVED. */
  markerPeriod: string | null;
  /** The most recent workbook period containing a real numeric price for this code. */
  latestPricedPeriod: string | null;
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
    {
      itemCode: string;
      allRemoved: boolean;
      markerPeriods: Set<string>;
      latestPricedPeriod: string | null;
    }
  >();

  for (const row of rows) {
    const itemCode = row.itemCode.trim();
    if (!itemCode) continue;
    const key = itemCode.toUpperCase();
    const group = byCode.get(key) ?? {
      itemCode,
      allRemoved: true,
      markerPeriods: new Set<string>(),
      latestPricedPeriod: null,
    };
    group.allRemoved &&= row.isRemoved;
    if (row.markerPeriod) group.markerPeriods.add(row.markerPeriod);
    if (
      row.latestPricedPeriod &&
      (!group.latestPricedPeriod ||
        row.latestPricedPeriod > group.latestPricedPeriod)
    ) {
      group.latestPricedPeriod = row.latestPricedPeriod;
    }
    byCode.set(key, group);
  }

  return [...byCode.values()]
    .flatMap((group) => {
      if (!group.allRemoved || group.markerPeriods.size === 0) return [];
      // A removal marker can coexist with the final historical price for its
      // own revision. Only a strictly later price proves the code returned.
      const discontinuedFrom = [...group.markerPeriods].sort()[0]!;
      if (
        group.latestPricedPeriod &&
        group.latestPricedPeriod > discontinuedFrom
      ) {
        return [];
      }
      return [{ itemCode: group.itemCode, discontinuedFrom }];
    })
    .sort((a, b) => a.itemCode.localeCompare(b.itemCode));
}