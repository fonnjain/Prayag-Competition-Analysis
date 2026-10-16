export type PriceHistoryStatus = "Current" | "Upcoming" | "Superseded";

export interface EffectiveDatedRevision {
  id: number;
  effectiveDate: string | null;
}

export interface CompetitorRevisionIdentity {
  competitor: string;
  matchedPrayagCode?: string | null;
  competitorCode?: string | null;
  description?: string | null;
  size?: string | null;
}

function normalizeCode(value: unknown): string {
  return String(value ?? "");
}

/**
 * Matches Comparison's revision grouping: matched rows share one timeline per
 * competitor + Prayag code, while unmatched rows retain their own SKU identity.
 */
export function competitorRevisionGroupKey(
  row: CompetitorRevisionIdentity,
): string {
  const mapping = row.matchedPrayagCode
    ? `matched:${normalizeCode(row.matchedPrayagCode)}`
    : `unmatched:${row.competitorCode ?? ""}:${row.description ?? ""}:${row.size ?? ""}`;
  return `${row.competitor}\u0000${mapping}`;
}

/**
 * Derive display status from effective dates. Stored is_current flags are
 * intentionally not accepted as input: they are caches and may be stale.
 *
 * Within each group, the highest-id row wins a same-date tie. The latest
 * winning row on or before asOf is Current; later winning rows are Upcoming;
 * all earlier and non-winning rows are Superseded.
 */
export function derivePriceHistoryStatuses<T extends EffectiveDatedRevision>(
  rows: readonly T[],
  asOf: string,
  groupKey: (row: T) => string,
  isEligible: (row: T) => boolean = () => true,
): Map<number, PriceHistoryStatus> {
  const statuses = new Map<number, PriceHistoryStatus>(
    rows.map((row) => [row.id, "Superseded"]),
  );
  const groups = new Map<string, T[]>();

  for (const row of rows) {
    if (!row.effectiveDate || !isEligible(row)) continue;
    const key = groupKey(row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    const winnerByDate = new Map<string, T>();
    for (const row of group) {
      const existing = winnerByDate.get(row.effectiveDate!);
      if (!existing || row.id > existing.id) {
        winnerByDate.set(row.effectiveDate!, row);
      }
    }

    const revisions = [...winnerByDate.values()].sort((a, b) =>
      a.effectiveDate!.localeCompare(b.effectiveDate!),
    );
    const current = revisions
      .filter((row) => row.effectiveDate! <= asOf)
      .at(-1);

    for (const row of revisions) {
      statuses.set(
        row.id,
        row.id === current?.id
          ? "Current"
          : row.effectiveDate! > asOf
            ? "Upcoming"
            : "Superseded",
      );
    }
  }

  return statuses;
}
