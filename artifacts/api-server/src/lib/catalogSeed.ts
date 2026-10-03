import { planNewProductCategories, assertCategorySpellingPlan, assertCategorySpellingPreview, lockCategorySpellings } from "./categorySpellingGuard";
import { assertCatalogueReplacementAllowed } from "./catalogueMaintenancePolicy";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { 
  catalogProductsTable,
  mrpPriceHistoryTable,
  mrpHistoryProvenanceEventsTable,
  mrpLoadBatchesTable,
  mrpSourcesTable,
  codeConflictsTable,
  competitorPricesTable,
} from "@workspace/db";
import catalogSeedData from "../seed/catalog-seed.json";
import competitorSeedData from "../seed/competitor-seed.json";
import { logger } from "./logger";
import { recomputeCurrentFlags, normCode } from "./catalog";
import { parseSizeFromName } from "./suggest";
import {
  getSanitarywareVariantSourceAudit,
  SANITARYWARE_VARIANT_SOURCE,
} from "./sanitarywareVariantSource";

interface SeedCatalogProduct {
  itemCode: string;
  productName: string | null;
  division: string | null;
  category: string | null;
  seriesRange: string | null;
  size: string | null;
  uom: string | null;
  isActive: boolean;
  sourceFiles: string | null;
  dataFlag: string | null;
}
interface SeedPriceRow {
  itemCode: string;
  mrp: number | null;
  netPrice: number | null;
  discountPct: number | null;
  priceBasis: string;
  effectiveDate: string;
  loadDate: string;
  sourceFile: string | null;
  isCurrent: boolean;
  notes: string | null;
}
interface SeedConflict {
  itemCode: string;
  conflictingNames: string | null;
  sources: string | null;
}
interface CatalogSeedFile {
  products: SeedCatalogProduct[];
  priceHistory: SeedPriceRow[];
  conflicts: SeedConflict[];
}
interface SeedCompetitorPrice {
  competitor: string;
  category: string | null;
  description: string | null;
  size: string | null;
  price: number;
  unit: string | null;
  effectiveDate: string | null;
  matchedPrayagCode: string | null;
  matchStatus: string;
  matchConfidence?: string | null;
}
interface CompetitorSeedFile {
  competitors: SeedCompetitorPrice[];
}

const data = catalogSeedData as CatalogSeedFile;
const competitorData = competitorSeedData as CompetitorSeedFile;
const CATALOG_SEED_SOURCE = {
  division: "Legacy catalog seed",
  sheetId: "internal-catalog-seed",
  sheetUrl: "internal://catalog-seed.json",
  expectedFileName: "catalog-seed.json",
  notes: "Checked-in application seed used only when initializing or explicitly resetting the catalogue.",
  sourceKind: "internal",
} as const;

async function chunkedInsert<T>(
  rows: T[],
  insertFn: (batch: T[]) => Promise<unknown>,
  size = 500,
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    await insertFn(rows.slice(i, i + size));
  }
}

export async function previewCatalogSeedCategories() {
  assertCatalogueReplacementAllowed("Catalogue seed preview");
  const plan = planNewProductCategories(data.products, await db.select().from(catalogProductsTable));
  assertCategorySpellingPlan(plan);
  return { categorySpellings: plan.categorySpellings, categorySpellingFingerprint: plan.categorySpellingFingerprint };
}
export async function loadCatalogSeed(expectedSpellingFingerprint?: string): Promise<void> {
  assertCatalogueReplacementAllowed("Catalogue seed");
  await db.transaction(async (tx) => {
    await lockCategorySpellings(tx);
    const storedProducts = await tx.select().from(catalogProductsTable);
    const categoryPlan = planNewProductCategories(data.products, storedProducts);
    assertCategorySpellingPlan(categoryPlan);
    if (expectedSpellingFingerprint !== undefined) assertCategorySpellingPreview(expectedSpellingFingerprint, categoryPlan);
    const guardedProducts = new Map(categoryPlan.rows.map(row => [row.itemCode, row]));
    const removedHistory = await tx
      .select({
        id: mrpPriceHistoryTable.id,
        itemCode: mrpPriceHistoryTable.itemCode,
        effectiveDate: mrpPriceHistoryTable.effectiveDate,
        mrp: mrpPriceHistoryTable.mrp,
        sourceFile: mrpPriceHistoryTable.sourceFile,
        loadBatchId: mrpPriceHistoryTable.loadBatchId,
      })
      .from(mrpPriceHistoryTable);
    if (removedHistory.length > 0) {
      await tx.insert(mrpHistoryProvenanceEventsTable).values(
        removedHistory.map((row) => ({
          historyRowId: row.id,
          itemCode: row.itemCode,
          effectiveDate: row.effectiveDate,
          action: "catalog_reset",
          reason: "Catalog reset restored the clean seed data.",
          sourceFile: row.sourceFile,
          loadBatchId: row.loadBatchId,
          mrp: row.mrp,
        })),
      );
    }

    await tx.delete(mrpPriceHistoryTable);
    await tx.delete(catalogProductsTable);
    await tx.delete(codeConflictsTable);
    await tx.delete(competitorPricesTable);

    await tx
      .insert(mrpSourcesTable)
      .values(CATALOG_SEED_SOURCE)
      .onConflictDoNothing({ target: mrpSourcesTable.sheetId });
    const [seedSource] = await tx
      .select({ id: mrpSourcesTable.id })
      .from(mrpSourcesTable)
      .where(eq(mrpSourcesTable.sheetId, CATALOG_SEED_SOURCE.sheetId))
      .limit(1);
    if (!seedSource) throw new Error("Catalog seed source could not be created.");
    const seedPayload = JSON.stringify(data.priceHistory);
    const [seedBatch] = await tx
      .insert(mrpLoadBatchesTable)
      .values({
        sourceId: seedSource.id,
        fileName: CATALOG_SEED_SOURCE.expectedFileName,
        fileSha256: createHash("sha256").update(seedPayload).digest("hex"),
        fileSizeBytes: Buffer.byteLength(seedPayload),
        downloadedAt:
          data.priceHistory
            .map((row) => row.loadDate)
            .sort()
            .at(-1) ?? "1970-01-01",
        rowCount: data.priceHistory.length,
        notes: CATALOG_SEED_SOURCE.notes,
      })
      .returning({ id: mrpLoadBatchesTable.id });
    if (!seedBatch) throw new Error("Catalog seed load batch could not be created.");

    await chunkedInsert(data.products, (batch) =>
      tx.insert(catalogProductsTable).values(
      batch.map((p) => ({
        itemCode: p.itemCode,
        productName: p.productName,
        division: guardedProducts.get(p.itemCode)!.division,
        category: guardedProducts.get(p.itemCode)!.category,
        seriesRange: guardedProducts.get(p.itemCode)!.seriesRange,
        // Persist the nominal size parsed from the product name when the source
        // size is blank, so size matching is exact for downstream consumers.
        size: p.size ?? parseSizeFromName(p.productName),
        uom: p.uom || "NOS",
        kgCost: null,
        isActive: guardedProducts.get(p.itemCode)!.isActive,
        sourceFiles: p.sourceFiles,
        dataFlag: p.dataFlag,
      })),
      ),
    );

    await chunkedInsert(data.priceHistory, async (batch) => {
      const inserted = await tx.insert(mrpPriceHistoryTable).values(
        batch.map((r) => ({
          itemCode: r.itemCode,
          mrp: r.mrp,
          netPrice: r.netPrice,
          discountPct: r.discountPct,
          priceBasis: r.priceBasis || "Verify",
          effectiveDate: r.effectiveDate,
          loadDate: r.loadDate,
          sourceFile: r.sourceFile,
          isCurrent: false,
          notes: r.notes,
          loadBatchId: seedBatch.id,
        })),
      ).returning({
        id: mrpPriceHistoryTable.id,
        itemCode: mrpPriceHistoryTable.itemCode,
        effectiveDate: mrpPriceHistoryTable.effectiveDate,
        mrp: mrpPriceHistoryTable.mrp,
        sourceFile: mrpPriceHistoryTable.sourceFile,
      });
      await tx.insert(mrpHistoryProvenanceEventsTable).values(
        inserted.map((row) => ({
          historyRowId: row.id,
          itemCode: row.itemCode,
          effectiveDate: row.effectiveDate,
          action: "legacy_seed_import",
          sourceFile: row.sourceFile,
          loadBatchId: seedBatch.id,
          mrp: row.mrp,
        })),
      );
    });

    if (data.conflicts.length > 0) {
      await tx.insert(codeConflictsTable).values(
        data.conflicts.map((c) => ({
          itemCode: c.itemCode,
          conflictingNames: c.conflictingNames,
          sources: c.sources,
        })),
      );
    }

  // Snapshot of the seed's current Prayag MRP (latest effective date per code).
  // This is retained for import auditability. The analysis gap itself resolves
  // the selected period from mrp_price_history, rather than reading this value.
  const currentMrpByCode = new Map<string, number>();
  const latestDateByCode = new Map<string, string>();
  for (const r of data.priceHistory) {
    if (r.mrp == null) continue;
    const key = normCode(r.itemCode);
    const prev = latestDateByCode.get(key);
    if (prev == null || r.effectiveDate > prev) {
      latestDateByCode.set(key, r.effectiveDate);
      currentMrpByCode.set(key, r.mrp);
    }
  }

    await chunkedInsert(competitorData.competitors, (batch) =>
      tx.insert(competitorPricesTable).values(
      batch.map((c) => {
        const matched = c.matchStatus === "matched" && c.matchedPrayagCode;
        const prayagMrpAtCompare = matched
          ? (currentMrpByCode.get(normCode(c.matchedPrayagCode!)) ?? null)
          : null;
        return {
          competitor: c.competitor,
          category: c.category,
          description: c.description,
          size: c.size,
          price: c.price,
          unit: c.unit,
          effectiveDate: c.effectiveDate,
          matchedPrayagCode: c.matchedPrayagCode,
          matchStatus: c.matchStatus,
          matchConfidence: c.matchConfidence ?? null,
          prayagMrpAtCompare,
        };
      }),
      ),
    );
  });

  await recomputeCurrentFlags();
}

export async function seedCatalogIfEmpty(): Promise<void> {
  assertCatalogueReplacementAllowed("Automatic catalogue seed");
  const existing = await db.select().from(catalogProductsTable).limit(1);
  if (existing.length === 0) {
    logger.info("Seeding Prayag product catalog from clean import file...");
    await loadCatalogSeed();
    logger.info("Catalog seed complete");
  }
}

// Populate the `size` column from the product name for rows where it is still
// blank. Idempotent and cheap: only touches rows that both lack a size and
// have a parseable nominal size in their name, so re-running is a no-op once
// the catalog is filled. Lets already-seeded databases benefit without a
// destructive full re-seed.
export async function backfillCatalogSizes(): Promise<void> {
  const rows = await db
    .select({
      id: catalogProductsTable.id,
      productName: catalogProductsTable.productName,
    })
    .from(catalogProductsTable)
    .where(
      sql`(${catalogProductsTable.size} IS NULL OR ${catalogProductsTable.size} = '')`,
    );

  const updates: { id: number; size: string }[] = [];
  for (const r of rows) {
    const parsed = parseSizeFromName(r.productName);
    if (parsed) updates.push({ id: r.id, size: parsed });
  }
  if (updates.length === 0) return;

  for (let i = 0; i < updates.length; i += 500) {
    const batch = updates.slice(i, i + 500);
    const cases = batch.map(
      (u) => sql`WHEN ${u.id} THEN ${u.size}`,
    );
    const ids = batch.map((u) => u.id);
    await db.execute(sql`
      UPDATE catalog_products
      SET size = CASE id ${sql.join(cases, sql` `)} END
      WHERE id IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )})
    `);
  }
  logger.info({ updated: updates.length }, "Backfilled catalog sizes from product names");
}

/**
 * Seed a fresh database, or audit an existing database, against the complete
 * sanitaryware colour source. Existing rows are never silently retrofitted:
 * provenance reconciliation requires the explicit admin workflow.
 */
export async function seedVariantPricesIfEmpty(): Promise<{
  sourceRows: number;
  uniqueRows: number;
  duplicateRows: number;
  missingRows: number;
  unbatchedRows: number;
  insertedRows: number;
}> {
  const audit = getSanitarywareVariantSourceAudit();
  const existing = await db.execute<{ cnt: string }>(sql`
    SELECT COUNT(*) AS cnt
    FROM mrp_price_history
    WHERE variant != 'Standard'
  `);
  const count = Number(existing.rows[0]?.cnt ?? 0);
  if (count > 0) {
    const existingRows = await db
      .select({
        itemCode: mrpPriceHistoryTable.itemCode,
        effectiveDate: mrpPriceHistoryTable.effectiveDate,
        variant: mrpPriceHistoryTable.variant,
        loadBatchId: mrpPriceHistoryTable.loadBatchId,
      })
      .from(mrpPriceHistoryTable)
      .where(sql`${mrpPriceHistoryTable.variant} != 'Standard'`);
    const sourceKeys = new Set(
      audit.uniqueRows.map(
        (row) => `${row.itemCode}\u001f${row.effectiveDate}\u001f${row.variant}`,
      ),
    );
    const existingByKey = new Map(
      existingRows.map((row) => [
        `${row.itemCode}\u001f${row.effectiveDate}\u001f${row.variant}`,
        row,
      ]),
    );
    const missingRows = [...sourceKeys].filter(
      (key) => !existingByKey.has(key),
    ).length;
    const unbatchedRows = [...sourceKeys].filter(
      (key) => existingByKey.get(key)?.loadBatchId == null,
    ).length;
    const report = {
      sourceRows: audit.rawRows.length,
      uniqueRows: audit.uniqueRows.length,
      duplicateRows: audit.duplicateKeys.length,
      missingRows,
      unbatchedRows,
      insertedRows: 0,
    };
    const details = {
        ...report,
        periodRows: Object.fromEntries(
          audit.periods.map((period) => [
            period.effectiveDate,
            period.rowCount,
          ]),
        ),
        duplicateKeys: audit.duplicateKeys,
      };
    const message =
      "Audited existing sanitaryware colour rows; explicit admin reconciliation is required for gaps";
    if (missingRows > 0 || unbatchedRows > 0) {
      logger.warn(details, message);
    } else {
      logger.info(details, message);
    }
    return report;
  }

  const today = new Date().toISOString().slice(0, 10);
  let inserted = 0;
  await db.transaction(async (tx) => {
    await tx
      .insert(mrpSourcesTable)
      .values(SANITARYWARE_VARIANT_SOURCE)
      .onConflictDoNothing({ target: mrpSourcesTable.sheetId });
    const [source] = await tx
      .select({ id: mrpSourcesTable.id })
      .from(mrpSourcesTable)
      .where(eq(mrpSourcesTable.sheetId, SANITARYWARE_VARIANT_SOURCE.sheetId))
      .limit(1);
    if (!source) throw new Error("Sanitaryware colour source could not be created.");

    for (const period of audit.periods) {
      const [loadBatch] = await tx
        .insert(mrpLoadBatchesTable)
        .values({
          sourceId: source.id,
          fileName: SANITARYWARE_VARIANT_SOURCE.expectedFileName,
          fileSha256: period.payloadSha256,
          fileSizeBytes: period.payloadBytes,
          downloadedAt: today,
          rowCount: period.rowCount,
          notes:
            `Application seed for the ${period.effectiveDate} period. SHA-256 and size identify the checked-in normalized period payload, not original XLSX bytes. The required downloaded_at field records the application seed date.`,
        })
        .returning({ id: mrpLoadBatchesTable.id });
      for (let index = 0; index < period.rows.length; index += 50) {
        const rows = period.rows.slice(index, index + 50);
        const result = await tx
          .insert(mrpPriceHistoryTable)
          .values(
            rows.map((row) => ({
              itemCode: row.itemCode,
              mrp: row.mrp,
              priceBasis: "MRP" as const,
              effectiveDate: row.effectiveDate,
              loadDate: today,
              sourceFile: SANITARYWARE_VARIANT_SOURCE.expectedFileName,
              isCurrent: false,
              reviewStatus: "approved" as const,
              loadBatchId: loadBatch.id,
              variant: row.variant,
            })),
          )
          .onConflictDoNothing()
          .returning({ id: mrpPriceHistoryTable.id });
        inserted += result.length;
      }
    }
  });

  if (inserted > 0) {
    await recomputeCurrentFlags();
  }
  const report = {
    sourceRows: audit.rawRows.length,
    uniqueRows: audit.uniqueRows.length,
    duplicateRows: audit.duplicateKeys.length,
    missingRows: 0,
    unbatchedRows: 0,
    insertedRows: inserted,
  };
  logger.info(report, "Sanitaryware variant prices seeded with period provenance");
  return report;
}
