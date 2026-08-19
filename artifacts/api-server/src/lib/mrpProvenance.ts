import { createHash } from "node:crypto";
import { db, mrpSourcesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export const OFFICIAL_MRP_SOURCES = [
  {
    division: "Pipes & Fittings",
    sheetId: "1Xyb8skpqAMIm5PF5d2HgKp8vRc0y4UHxWFfItD3ZcJk",
    expectedFileName: "MRP w.e.f. 01st Feb, 2026 Pipe & Fitting.xlsx",
    notes: null,
  },
  {
    division: "PTMT & Plastic Fittings",
    sheetId: "1PnzjXxDfnG-9asuvQ9nR_Vho26q-ulWeOwEL7hyBAFU",
    expectedFileName: "NEW PTMT MRP w.e.f. List as on 01st Sep, 2026.xlsx",
    notes:
      "The 19 Aug 2026 snapshot is known to differ from the live sheet in 600-series September price cells.",
  },
  {
    division: "CP Fittings / Faucets",
    sheetId: "1-3boSoPGeSRIM-ruFX-FgHqaBBI3DBCuWoOWLl0RRAM",
    expectedFileName: "New CP MRP w.e.f. 01st Aug, 2026.xlsx",
    notes: null,
  },
  {
    division: "Ceramic Sanitaryware",
    sheetId: "1TJ5Xg2GYMBHQzsrk0kKtM-iRI3tvG1eTmon5HZGU9F0",
    expectedFileName: "SANITARYWARE NEW MRP w.e.f. 01st May, 2026.xlsx",
    notes: null,
  },
  {
    division: "Hardware",
    sheetId: "1YxBT9NUfLD0mK0d1T2DbLRTkYwXZct5frrJkZnCXhIA",
    expectedFileName: "NEW HARDWARE Price List as on 01st Mar, 2026.xlsx",
    notes: null,
  },
  {
    division: "CP (QUAA / FERN)",
    sheetId: "1ViubLx1zOjUvFXJWDQUHAMBgqty8py8vHmEawYMe4qg",
    expectedFileName: "MRP w.e.f. 15th Feb, 2024 QUAA & FERN.xlsx",
    notes: null,
  },
] as const;

const MANUAL_MRP_SOURCE = {
  division: "Manual MRP corrections",
  sheetId: "manual-mrp-corrections",
  sheetUrl: "about:blank",
  expectedFileName: null,
  notes: "Internal audit source for reviewed corrections made without an official workbook.",
  sourceKind: "manual",
} as const;

export function sourceUrl(sheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
}

export async function ensureOfficialMrpSources(): Promise<void> {
  for (const source of OFFICIAL_MRP_SOURCES) {
    await db
      .insert(mrpSourcesTable)
      .values({ ...source, sheetUrl: sourceUrl(source.sheetId), sourceKind: "official" })
      .onConflictDoNothing({ target: mrpSourcesTable.sheetId });
  }
}

export async function ensureManualMrpSource(): Promise<number> {
  await db
    .insert(mrpSourcesTable)
    .values(MANUAL_MRP_SOURCE)
    .onConflictDoNothing({ target: mrpSourcesTable.sheetId });
  const rows = await db
    .select({ id: mrpSourcesTable.id })
    .from(mrpSourcesTable)
    .where(eq(mrpSourcesTable.sheetId, MANUAL_MRP_SOURCE.sheetId))
    .limit(1);
  if (!rows[0]) throw new Error("Manual MRP provenance source could not be created.");
  return rows[0].id;
}

export function sha256ForBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function sha256ForManualCorrection(input: {
  itemCode: string;
  effectiveDate: string;
  mrp: number;
  reason: string;
}): string {
  return sha256ForBuffer(Buffer.from(JSON.stringify(input)));
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}