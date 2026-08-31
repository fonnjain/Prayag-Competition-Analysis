import { createHash } from "node:crypto";
import {
  catalogProductsTable,
  db,
  mrpHistoryProvenanceEventsTable,
  mrpLoadBatchesTable,
  mrpPriceHistoryTable,
  mrpSourcesTable,
} from "@workspace/db";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import {
  AUDITED_LEGACY_MRP_HISTORY_IDS,
  AUDITED_LEGACY_MRP_IDENTITY_MD5,
} from "./legacyMrpAuditManifest";

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

export interface LegacyMrpClassificationScope {
  sourceSheetId: string;
  sourceDivision: string;
  sourceFile: string;
  effectiveDate: string;
  loadDate: string;
  productDivision: string;
  expectedRows: number;
  expectedDistinctCodes: number;
  historyRowIds: readonly number[];
  expectedIdentityMd5: string;
}

export const AUDITED_LEGACY_MRP_SCOPE: LegacyMrpClassificationScope = {
  sourceSheetId: "pre-provenance-sanitaryware-variant-prices-2026-01-15",
  sourceDivision: "Ceramic Sanitaryware — pre-provenance legacy",
  sourceFile: "Prayag_Sanitaryware_Variant_Prices.xlsx",
  effectiveDate: "2026-01-15",
  loadDate: "2026-08-19",
  productDivision: "Ceramic Sanitaryware",
  expectedRows: 148,
  expectedDistinctCodes: 121,
  historyRowIds: AUDITED_LEGACY_MRP_HISTORY_IDS,
  expectedIdentityMd5: AUDITED_LEGACY_MRP_IDENTITY_MD5,
};

const LEGACY_CLASSIFICATION_ACTION = "pre_provenance_legacy_classified";
const LEGACY_CLASSIFICATION_REASON =
  "Origin unknown: historical row predates provenance tracking. Synthetic classification only; no official workbook attribution inferred.";

async function legacyIdentityDigest(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  historyRowIds: readonly number[],
): Promise<string> {
  const result = await tx.execute<{ identity_digest: string }>(sql`
    SELECT md5(COALESCE(string_agg(
      concat_ws(chr(31),
        mrp_price_history.id,
        mrp_price_history.item_code,
        mrp_price_history.variant,
        mrp_price_history.effective_date,
        mrp_price_history.load_date,
        mrp_price_history.source_file,
        mrp_price_history.price_basis,
        mrp_price_history.review_status,
        mrp_price_history.mrp,
        mrp_price_history.net_price,
        mrp_price_history.discount_pct,
        mrp_price_history.notes,
        mrp_price_history.import_batch_id
      ),
      chr(30) ORDER BY mrp_price_history.id
    ), '')) AS identity_digest
    FROM mrp_price_history
    WHERE ${inArray(mrpPriceHistoryTable.id, [...historyRowIds])}
  `);
  return result.rows[0]?.identity_digest ?? "";
}

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

export async function classifyLegacyMrpRows(input: {
  loadedBy: string | null;
  scope?: LegacyMrpClassificationScope;
}): Promise<{
  loadBatchId: number;
  classifiedRows: number;
  distinctCodes: number;
  alreadyClassified: boolean;
}> {
  const scope = input.scope ?? AUDITED_LEGACY_MRP_SCOPE;
  const classificationHash = sha256ForBuffer(
    Buffer.from(
      JSON.stringify({
        kind: "pre-provenance-legacy-classification",
        sourceFile: scope.sourceFile,
        effectiveDate: scope.effectiveDate,
        loadDate: scope.loadDate,
        productDivision: scope.productDivision,
        expectedRows: scope.expectedRows,
      }),
    ),
  );

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(917_903)`);

    await tx
      .insert(mrpSourcesTable)
      .values({
        division: scope.sourceDivision,
        sheetId: scope.sourceSheetId,
        sheetUrl: "about:blank",
        expectedFileName: scope.sourceFile,
        notes:
          "Synthetic source for audited rows that predate provenance tracking. The original workbook checksum, download date, and loader identity are unknown.",
        sourceKind: "legacy",
      })
      .onConflictDoUpdate({
        target: mrpSourcesTable.sheetId,
        set: {
          division: scope.sourceDivision,
          sheetUrl: "about:blank",
          expectedFileName: scope.sourceFile,
          notes:
            "Synthetic source for audited rows that predate provenance tracking. The original workbook checksum, download date, and loader identity are unknown.",
          sourceKind: "legacy",
        },
      });
    const [source] = await tx
      .select({ id: mrpSourcesTable.id })
      .from(mrpSourcesTable)
      .where(eq(mrpSourcesTable.sheetId, scope.sourceSheetId))
      .limit(1);
    if (!source) {
      throw new Error("The pre-provenance legacy source could not be created.");
    }

    const [existingBatch] = await tx
      .select({
        id: mrpLoadBatchesTable.id,
        rowCount: mrpLoadBatchesTable.rowCount,
      })
      .from(mrpLoadBatchesTable)
      .where(
        and(
          eq(mrpLoadBatchesTable.sourceId, source.id),
          eq(mrpLoadBatchesTable.fileSha256, classificationHash),
        ),
      )
      .limit(1);

    const candidates = await tx
      .select({
        id: mrpPriceHistoryTable.id,
        itemCode: mrpPriceHistoryTable.itemCode,
        effectiveDate: mrpPriceHistoryTable.effectiveDate,
        sourceFile: mrpPriceHistoryTable.sourceFile,
        mrp: mrpPriceHistoryTable.mrp,
      })
      .from(mrpPriceHistoryTable)
      .innerJoin(
        catalogProductsTable,
        eq(catalogProductsTable.itemCode, mrpPriceHistoryTable.itemCode),
      )
      .where(
        and(
          isNull(mrpPriceHistoryTable.loadBatchId),
          inArray(mrpPriceHistoryTable.id, [...scope.historyRowIds]),
          eq(mrpPriceHistoryTable.sourceFile, scope.sourceFile),
          eq(mrpPriceHistoryTable.effectiveDate, scope.effectiveDate),
          eq(mrpPriceHistoryTable.loadDate, scope.loadDate),
          eq(catalogProductsTable.division, scope.productDivision),
        ),
      );

    const signatureMatches = await tx
      .select({ id: mrpPriceHistoryTable.id })
      .from(mrpPriceHistoryTable)
      .innerJoin(
        catalogProductsTable,
        eq(catalogProductsTable.itemCode, mrpPriceHistoryTable.itemCode),
      )
      .where(
        and(
          isNull(mrpPriceHistoryTable.loadBatchId),
          eq(mrpPriceHistoryTable.sourceFile, scope.sourceFile),
          eq(mrpPriceHistoryTable.effectiveDate, scope.effectiveDate),
          eq(mrpPriceHistoryTable.loadDate, scope.loadDate),
          eq(catalogProductsTable.division, scope.productDivision),
        ),
      );
    const auditedIds = new Set(scope.historyRowIds);
    const candidateIds = new Set(candidates.map((row) => row.id));
    const candidateIdentityMatches =
      candidates.length === scope.historyRowIds.length &&
      candidateIds.size === auditedIds.size &&
      [...auditedIds].every((id) => candidateIds.has(id)) &&
      signatureMatches.length === scope.expectedRows &&
      signatureMatches.every((row) => auditedIds.has(row.id)) &&
      (await legacyIdentityDigest(tx, scope.historyRowIds)) ===
        scope.expectedIdentityMd5;

    if (existingBatch) {
      const linked = await tx
        .select({ id: mrpPriceHistoryTable.id })
        .from(mrpPriceHistoryTable)
        .innerJoin(
          catalogProductsTable,
          eq(catalogProductsTable.itemCode, mrpPriceHistoryTable.itemCode),
        )
        .where(
          and(
            eq(mrpPriceHistoryTable.loadBatchId, existingBatch.id),
            inArray(mrpPriceHistoryTable.id, [...scope.historyRowIds]),
            eq(mrpPriceHistoryTable.sourceFile, scope.sourceFile),
            eq(mrpPriceHistoryTable.effectiveDate, scope.effectiveDate),
            eq(mrpPriceHistoryTable.loadDate, scope.loadDate),
            eq(catalogProductsTable.division, scope.productDivision),
          ),
        );
      const linkedIds = new Set(linked.map((row) => row.id));
      const [membershipCount] = (
        await tx.execute<{ history_count: number; event_count: number }>(sql`
          SELECT
            (SELECT COUNT(*)::int FROM mrp_price_history
             WHERE load_batch_id = ${existingBatch.id}) AS history_count,
            (SELECT COUNT(*)::int FROM mrp_history_provenance_events
             WHERE load_batch_id = ${existingBatch.id}
               AND action = ${LEGACY_CLASSIFICATION_ACTION}) AS event_count
        `)
      ).rows;
      const existingIsExact =
        candidates.length === 0 &&
        signatureMatches.length === 0 &&
        existingBatch.rowCount === scope.expectedRows &&
        linked.length === scope.expectedRows &&
        linkedIds.size === auditedIds.size &&
        [...auditedIds].every((id) => linkedIds.has(id)) &&
        membershipCount?.history_count === scope.expectedRows &&
        membershipCount?.event_count === scope.expectedRows &&
        (await legacyIdentityDigest(tx, scope.historyRowIds)) ===
          scope.expectedIdentityMd5;
      if (!existingIsExact) {
        throw new Error(
          "The existing synthetic legacy batch does not exactly match the audited row manifest. No rows were changed.",
        );
      }
      return {
        loadBatchId: existingBatch.id,
        classifiedRows: 0,
        distinctCodes: scope.expectedDistinctCodes,
        alreadyClassified: true,
      };
    }
    const distinctCodes = new Set(candidates.map((row) => row.itemCode)).size;
    if (
      candidates.length !== scope.expectedRows ||
      distinctCodes !== scope.expectedDistinctCodes ||
      !candidateIdentityMatches
    ) {
      throw new Error(
        `Legacy classification did not exactly match the audited manifest of ${scope.expectedRows} rows across ${scope.expectedDistinctCodes} codes. No rows were changed.`,
      );
    }

    const loadBatchId = (
      await tx
        .insert(mrpLoadBatchesTable)
        .values({
          sourceId: source.id,
          fileName: scope.sourceFile,
          fileSha256: classificationHash,
          fileSizeBytes: 0,
          // The original download date is unavailable. This required field
          // records the historical row load date, as disclosed in notes.
          downloadedAt: scope.loadDate,
          loadedBy: input.loadedBy,
          rowCount: scope.expectedRows,
          notes:
            `${LEGACY_CLASSIFICATION_REASON} The required downloaded_at field records the legacy row load date ${scope.loadDate}; file size and original checksum are unavailable.`,
        })
        .returning({ id: mrpLoadBatchesTable.id })
    )[0]!.id;

    await tx
      .update(mrpPriceHistoryTable)
      .set({ loadBatchId })
      .where(inArray(mrpPriceHistoryTable.id, candidates.map((row) => row.id)));
    for (let index = 0; index < candidates.length; index += 500) {
      await tx.insert(mrpHistoryProvenanceEventsTable).values(
        candidates.slice(index, index + 500).map((row) => ({
          historyRowId: row.id,
          itemCode: row.itemCode,
          effectiveDate: row.effectiveDate,
          action: LEGACY_CLASSIFICATION_ACTION,
          reason: LEGACY_CLASSIFICATION_REASON,
          sourceFile: row.sourceFile,
          loadBatchId,
          mrp: row.mrp,
        })),
      );
    }

    return {
      loadBatchId,
      classifiedRows: candidates.length,
      distinctCodes,
      alreadyClassified: false,
    };
  });
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
