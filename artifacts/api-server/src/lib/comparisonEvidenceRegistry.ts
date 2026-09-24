// Durable, review-only evidence from P045 Step 5.  These markers are keyed
// by the complete comparison identity so an observation from one period cannot
// leak into another period.
export type ComparisonEvidence = {
  kind: "product-identity-dispute" | "price-dispute" | "not-verified";
  reason: string;
};

type EvidenceEntry = {
  competitor: string;
  competitorCode: string;
  prayagCode: string;
  effectiveDate: string;
  evidence: ComparisonEvidence;
};

const ENTRIES: EvidenceEntry[] = [
  {
    competitor: "Apollo",
    competitorCode: "PMN03122V",
    prayagCode: "5762",
    effectiveDate: "2026-08-01",
    evidence: {
      kind: "price-dispute",
      reason: "Workbook records ₹27; PDF records ₹60 against a different fitting (row misalignment).",
    },
  },
  {
    competitor: "Apollo",
    competitorCode: "PMN032404",
    prayagCode: "5793",
    effectiveDate: "2026-08-01",
    evidence: {
      kind: "product-identity-dispute",
      reason: "PDF page 24 says WITHOUT JALI; workbook says Multi Floor Trap with Jali. Both quote ₹187.50.",
    },
  },
  ...[
    "CM02350W0V", "CM0235010V", "PM0389042V", "PM03890403",
    "PM03890404", "PM03890402", "PPRMB021225MM0V",
    "PPRMB021720MM0V", "PPRMB021725MM0V",
  ].map((code): EvidenceEntry => ({
    competitor: "Apollo",
    competitorCode: code,
    prayagCode: ({
      CM02350W0V: "CM21",
      CM0235010V: "CM31",
      PM0389042V: "5763",
      PM03890403: "5963",
      PM03890404: "5163",
      PM03890402: "4763",
      PPRMB021225MM0V: "PG403",
      PPRMB021720MM0V: "PG412",
      PPRMB021725MM0V: "PG413",
    } as Record<string, string>)[code],
    effectiveDate: "2026-08-01",
    evidence: {
      kind: "not-verified",
      reason: "PDF evidence was insufficient to verify the product label against the workbook.",
    },
  })),
];

const key = (competitor: string, competitorCode: string, prayagCode: string, effectiveDate: string) =>
  `${competitor}\u0000${competitorCode}\u0000${prayagCode.toUpperCase()}\u0000${effectiveDate}`;

const registry = new Map(
  ENTRIES.map((entry) => [
    key(entry.competitor, entry.competitorCode, entry.prayagCode, entry.effectiveDate),
    entry.evidence,
  ]),
);

export function getComparisonEvidence(
  competitor: string,
  competitorCode: string | null,
  prayagCode: string | null,
  effectiveDate: string | null,
): ComparisonEvidence | null {
  if (!competitorCode || !prayagCode || !effectiveDate) return null;
  return registry.get(key(competitor, competitorCode, prayagCode, effectiveDate)) ?? null;
}
