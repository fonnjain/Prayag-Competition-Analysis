import { bucketCompetitorAllowed, hasBucketCompetitorFilter } from "./bucketFilter";

/** Project immutable frozen evidence; never persist or reevaluate a policy. */
export function projectCompetitorEvidence(value: any, code: string): any {
  if (!hasBucketCompetitorFilter() || value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(row => projectCompetitorEvidence(row, code)).filter(row => row != null);
  if (typeof value.competitor === "string" && !bucketCompetitorAllowed(value.competitor, code)) return null;
  const projected: Record<string, any> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "staleCompetitors" && Array.isArray(entry)) projected[key] = entry.filter(name => bucketCompetitorAllowed(String(name), code));
    else projected[key] = projectCompetitorEvidence(entry, code);
  }
  if (typeof value.selectedCompetitor === "string" && !bucketCompetitorAllowed(value.selectedCompetitor, code)) {
    Object.assign(projected, { selectedCompetitor: null, selectedCompetitorPrice: null,
      gap: null, rawTarget: null, band: null, action: "hold",
      status: "excluded", reason: "Competitor evidence excluded by bucket filter. Original run is unchanged.",
      proposedMrp: null, candidateMrp: null, suggestedMrp: null, changePercent: null, deltaMrp: null });
  }
  return projected;
}
export function projectFrozenResult<T extends { itemCode: string; evidence: string | null }>(row: T, policy?: Record<string, any>): T {
  if (!hasBucketCompetitorFilter()) return row;
  const evidence = JSON.parse(row.evidence ?? "{}");
  const projected = projectCompetitorEvidence(evidence, row.itemCode);
  const values = typeof (row as any).competitorValues === "string" ? JSON.parse((row as any).competitorValues) : [];
  const allowedValues = projectCompetitorEvidence(values, row.itemCode);
  const selected = policy?.selectedCompetitor ?? evidence.selectedCompetitor;
  const held = typeof selected === "string" ? !bucketCompetitorAllowed(selected, row.itemCode)
    : values.length !== allowedValues.length;
  return { ...row, ...(held ? { status: "excluded", reason: "Competitor evidence excluded by bucket filter. Original run is unchanged.",
    proposedMrp: null, candidateMrp: null, suggestedMrp: null, changePercent: null, deltaMrp: null } : {}),
    ...(typeof (row as any).competitorValues === "string" ? { competitorValues: JSON.stringify(allowedValues) } : {}),
    ...(held ? { trace: "[]" } : {}), evidence: JSON.stringify(projected ?? {}) };
}
