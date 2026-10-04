/** Shared Included / Excluded presentation. One source for colours and wording on every screen. */
export type BucketKind = "included" | "excluded";

export const BUCKET_TYPE: Record<BucketKind, {
  label: string; heading: string; sub: string;
  dot: string; bg: string; border: string; text: string; soft: string;
  badgeClass: string; cardOnClass: string;
}> = {
  included: {
    label: "Included", heading: "SHOW ONLY THESE", sub: "Included",
    dot: "#0284c7", bg: "#e0f2fe", border: "#0284c7", text: "#0c4a6e", soft: "#f0f9ff",
    badgeClass: "bg-sky-200 text-sky-950", cardOnClass: "border-sky-600 bg-sky-100",
  },
  excluded: {
    label: "Excluded", heading: "HIDE THESE", sub: "Excluded",
    dot: "#d97706", bg: "#fef3c7", border: "#d97706", text: "#78350f", soft: "#fffbeb",
    badgeClass: "bg-amber-200 text-amber-950", cardOnClass: "border-amber-600 bg-amber-100",
  },
};

export const bucketKind = (t?: string | null): BucketKind => (t === "excluded" ? "excluded" : "included");

/** Presentation ordering only; never change stored names or resolved membership. */
export function groupBucketChoices<T extends { type?: string; visibility?: string; name?: string }>(lists: readonly T[]) {
  const groups: Record<BucketKind, T[]> = { included: [], excluded: [] };
  for (const list of lists) groups[bucketKind(list.type)].push(list);
  for (const kind of ["included", "excluded"] as const) {
    groups[kind].sort((a, b) =>
      Number(b.visibility === "everyone") - Number(a.visibility === "everyone") ||
      (a.name ?? "").localeCompare(b.name ?? ""));
  }
  return groups;
}

/** Short on-screen effect. Exports keep bucketEffectText / the backend banner. */
export function bucketEffectShort(type: string | undefined | null, count: number): string {
  const n = count.toLocaleString();
  return bucketKind(type) === "excluded" ? `${n} hidden` : `only ${n} shown`;
}
