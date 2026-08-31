import { createHash } from "node:crypto";
import sanitarywareVariantSeedData from "../data/sanitaryware-variant-seed.json";

export type SanitarywareVariantSourceRow = {
  itemCode: string;
  mrp: number;
  effectiveDate: string;
  variant: string;
};

export const SANITARYWARE_VARIANT_SOURCE = {
  division: "Ceramic Sanitaryware colour variants",
  sheetId: "prayag-sanitaryware-colour-variant-workbook",
  sheetUrl: "about:blank",
  expectedFileName: "Prayag_Sanitaryware_Variant_Prices.xlsx",
  sourceKind: "known_source",
  notes:
    "Known sanitaryware colour-variant source represented by the checked-in normalized payload. The original XLSX bytes are not retained; batch hashes identify period payloads, not workbook bytes.",
} as const;

function rowKey(row: SanitarywareVariantSourceRow): string {
  return `${row.itemCode}\u001f${row.effectiveDate}\u001f${row.variant}`;
}

export function getSanitarywareVariantSourceAudit() {
  const rawRows = sanitarywareVariantSeedData as SanitarywareVariantSourceRow[];
  const uniqueByKey = new Map<string, SanitarywareVariantSourceRow>();
  const duplicateKeys: string[] = [];
  for (const row of rawRows) {
    const key = rowKey(row);
    const existing = uniqueByKey.get(key);
    if (existing) {
      if (existing.mrp !== row.mrp) {
        throw new Error(`Conflicting sanitaryware colour source rows for ${key}.`);
      }
      duplicateKeys.push(key);
      continue;
    }
    uniqueByKey.set(key, row);
  }
  const uniqueRows = [...uniqueByKey.values()];
  const periods = [...new Set(uniqueRows.map((row) => row.effectiveDate))]
    .sort()
    .map((effectiveDate) => {
      const rows = uniqueRows.filter(
        (row) => row.effectiveDate === effectiveDate,
      );
      const payload = Buffer.from(JSON.stringify(rows));
      return {
        effectiveDate,
        rows,
        rowCount: rows.length,
        payloadSha256: createHash("sha256").update(payload).digest("hex"),
        payloadBytes: payload.length,
      };
    });

  if (
    rawRows.length !== 300 ||
    uniqueRows.length !== 298 ||
    periods[0]?.effectiveDate !== "2026-01-15" ||
    periods[0]?.rowCount !== 148 ||
    periods[1]?.effectiveDate !== "2026-05-01" ||
    periods[1]?.rowCount !== 150 ||
    duplicateKeys.length !== 2 ||
    !duplicateKeys.every((key) => key.startsWith("4663\u001f"))
  ) {
    throw new Error(
      "The sanitaryware colour source shape changed; review its period and duplicate-key expectations before loading.",
    );
  }

  return {
    rawRows,
    uniqueRows,
    duplicateKeys,
    periods,
  };
}