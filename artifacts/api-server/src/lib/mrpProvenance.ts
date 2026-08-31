import { createHash } from "node:crypto";
import {
  catalogProductsTable,
  db,
  mrpHistoryProvenanceEventsTable,
  mrpLoadBatchesTable,
  mrpPriceHistoryTable,
  mrpSourcesTable,
} from "@workspace/db";
import { and, eq, inArray, lt, sql } from "drizzle-orm";

const HARDWARE_SOURCE_SHEET_ID =
  "1YxBT9NUfLD0mK0d1T2DbLRTkYwXZct5frrJkZnCXhIA";

export const HARDWARE_REPLACEMENT_SNAPSHOT = {
  fileName: "Prayag_MRP_Authoritative_01Sep2026.xlsx",
  fileSha256:
    "a6cd9c4d82ab60a1b77644edba5446af90bf9df25174095e791b6c23f773cab2",
  fileSizeBytes: 379_091,
  downloadedAt: "2026-08-31",
  effectiveDate: "2026-09-01",
  expectedRows: 285,
  expectedRevisions: 277,
  expectedAdditions: 8,
  notes:
    "Verified Hardware slice from the authoritative Prayag-returned 01 Sep 2026 master; replaces the legacy March-only Hardware snapshot.",
} as const;

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
    sheetId: HARDWARE_SOURCE_SHEET_ID,
    expectedFileName: HARDWARE_REPLACEMENT_SNAPSHOT.fileName,
    notes:
      "The linked Google Sheet remains March-only. The latest verified Hardware snapshot is the Hardware slice of the authoritative Prayag-returned 01 Sep 2026 master.",
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

export const AUTHORITATIVE_MASTER_SOURCE = {
  division: "Authoritative multi-division master",
  sheetId: "authoritative-master-2026-09-01",
  sheetUrl: "about:blank",
  expectedFileName: "Prayag_MRP_Authoritative_01Sep2026.xlsx",
  notes:
    "Authoritative master returned by Prayag, superseding the compiled 01 Sep list.",
  sourceKind: "authoritative",
} as const;

export function sourceUrl(sheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
}

export async function ensureOfficialMrpSources(): Promise<void> {
  for (const source of OFFICIAL_MRP_SOURCES) {
    await db
      .insert(mrpSourcesTable)
      .values({ ...source, sheetUrl: sourceUrl(source.sheetId), sourceKind: "official" })
      .onConflictDoUpdate({
        target: mrpSourcesTable.sheetId,
        set: {
          division: source.division,
          sheetUrl: sourceUrl(source.sheetId),
          expectedFileName: source.expectedFileName,
          notes: source.notes,
          sourceKind: "official",
        },
      });
  }
}

export async function ensureHardwareReplacementSnapshot(
  loadedBy: string | null,
): Promise<{
  loadBatchId: number;
  rows: number;
  revisions: number;
  additions: number;
}> {
  await ensureOfficialMrpSources();

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(917_902)`);

    const [hardwareSource] = await tx
      .select({ id: mrpSourcesTable.id })
      .from(mrpSourcesTable)
      .where(eq(mrpSourcesTable.sheetId, HARDWARE_SOURCE_SHEET_ID))
      .limit(1);
    if (!hardwareSource) {
      throw new Error("The official Hardware provenance source is missing.");
    }

    const candidates = await tx
      .select({
        id: mrpPriceHistoryTable.id,
        itemCode: mrpPriceHistoryTable.itemCode,
        mrp: mrpPriceHistoryTable.mrp,
      })
      .from(mrpPriceHistoryTable)
      .innerJoin(
        catalogProductsTable,
        eq(catalogProductsTable.itemCode, mrpPriceHistoryTable.itemCode),
      )
      .where(
        and(
          eq(catalogProductsTable.division, "Hardware"),
          eq(
            mrpPriceHistoryTable.effectiveDate,
            HARDWARE_REPLACEMENT_SNAPSHOT.effectiveDate,
          ),
          eq(mrpPriceHistoryTable.variant, "Standard"),
          eq(
            mrpPriceHistoryTable.sourceFile,
            HARDWARE_REPLACEMENT_SNAPSHOT.fileName,
          ),
        ),
      );
    if (candidates.length !== HARDWARE_REPLACEMENT_SNAPSHOT.expectedRows) {
      throw new Error(
        `Hardware replacement requires ${HARDWARE_REPLACEMENT_SNAPSHOT.expectedRows} verified September rows; found ${candidates.length}.`,
      );
    }

    const candidateCodes = candidates.map((row) => row.itemCode);
    const priorRows = await tx
      .selectDistinct({ itemCode: mrpPriceHistoryTable.itemCode })
      .from(mrpPriceHistoryTable)
      .where(
        and(
          inArray(mrpPriceHistoryTable.itemCode, candidateCodes),
          lt(
            mrpPriceHistoryTable.effectiveDate,
            HARDWARE_REPLACEMENT_SNAPSHOT.effectiveDate,
          ),
          eq(mrpPriceHistoryTable.variant, "Standard"),
        ),
      );
    const revisions = priorRows.length;
    const additions = candidates.length - revisions;
    if (
      revisions !== HARDWARE_REPLACEMENT_SNAPSHOT.expectedRevisions ||
      additions !== HARDWARE_REPLACEMENT_SNAPSHOT.expectedAdditions
    ) {
      throw new Error(
        `Hardware replacement expected ${HARDWARE_REPLACEMENT_SNAPSHOT.expectedRevisions} revisions and ${HARDWARE_REPLACEMENT_SNAPSHOT.expectedAdditions} additions; found ${revisions} and ${additions}.`,
      );
    }

    const [existingBatch] = await tx
      .select({ id: mrpLoadBatchesTable.id })
      .from(mrpLoadBatchesTable)
      .where(
        and(
          eq(mrpLoadBatchesTable.sourceId, hardwareSource.id),
          eq(
            mrpLoadBatchesTable.fileSha256,
            HARDWARE_REPLACEMENT_SNAPSHOT.fileSha256,
          ),
        ),
      )
      .limit(1);
    const loadBatchId =
      existingBatch?.id ??
      (
        await tx
          .insert(mrpLoadBatchesTable)
          .values({
            sourceId: hardwareSource.id,
            fileName: HARDWARE_REPLACEMENT_SNAPSHOT.fileName,
            fileSha256: HARDWARE_REPLACEMENT_SNAPSHOT.fileSha256,
            fileSizeBytes: HARDWARE_REPLACEMENT_SNAPSHOT.fileSizeBytes,
            downloadedAt: HARDWARE_REPLACEMENT_SNAPSHOT.downloadedAt,
            loadedBy,
            rowCount: HARDWARE_REPLACEMENT_SNAPSHOT.expectedRows,
            notes: HARDWARE_REPLACEMENT_SNAPSHOT.notes,
          })
          .returning({ id: mrpLoadBatchesTable.id })
      )[0]!.id;

    await tx
      .update(mrpPriceHistoryTable)
      .set({ loadBatchId })
      .where(inArray(mrpPriceHistoryTable.id, candidates.map((row) => row.id)));

    const alreadyRecorded = await tx
      .select({ historyRowId: mrpHistoryProvenanceEventsTable.historyRowId })
      .from(mrpHistoryProvenanceEventsTable)
      .where(
        and(
          eq(mrpHistoryProvenanceEventsTable.action, "hardware_source_replaced"),
          eq(mrpHistoryProvenanceEventsTable.loadBatchId, loadBatchId),
        ),
      );
    const recordedIds = new Set(
      alreadyRecorded
        .map((row) => row.historyRowId)
        .filter((id): id is number => id != null),
    );
    const unrecorded = candidates.filter((row) => !recordedIds.has(row.id));
    for (let index = 0; index < unrecorded.length; index += 500) {
      await tx.insert(mrpHistoryProvenanceEventsTable).values(
        unrecorded.slice(index, index + 500).map((row) => ({
          historyRowId: row.id,
          itemCode: row.itemCode,
          effectiveDate: HARDWARE_REPLACEMENT_SNAPSHOT.effectiveDate,
          action: "hardware_source_replaced",
          reason: HARDWARE_REPLACEMENT_SNAPSHOT.notes,
          sourceFile: HARDWARE_REPLACEMENT_SNAPSHOT.fileName,
          loadBatchId,
          mrp: row.mrp,
        })),
      );
    }

    return {
      loadBatchId,
      rows: candidates.length,
      revisions,
      additions,
    };
  });
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
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}
