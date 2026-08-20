import { eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
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
import sanitarywareVariantSeedData from "../data/sanitaryware-variant-seed.json";
import { logger } from "./logger";
import { recomputeCurrentFlags, normCode } from "./catalog";
import { parseSizeFromName } from "./suggest";

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

async function chunkedInsert<T>(
  rows: T[],
  insertFn: (batch: T[]) => Promise<unknown>,
  size = 500,
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    await insertFn(rows.slice(i, i + size));
  }
}

export async function loadCatalogSeed(): Promise<void> {
  await db.transaction(async (tx) => {
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

    await chunkedInsert(data.products, (batch) =>
      tx.insert(catalogProductsTable).values(
      batch.map((p) => ({
        itemCode: p.itemCode,
        productName: p.productName,
        division: p.division,
        category: p.category,
        seriesRange: p.seriesRange,
        // Persist the nominal size parsed from the product name when the source
        // size is blank, so size matching is exact for downstream consumers.
        size: p.size ?? parseSizeFromName(p.productName),
        uom: p.uom || "NOS",
        kgCost: null,
        isActive: p.isActive,
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
 * One-time idempotent seed for sanitaryware colour-variant prices
 * (Ivory / White with Jet / Pink-Green-Blue across 123 items, two periods).
 * Skips gracefully if any non-Standard rows already exist.
 */
export async function seedVariantPricesIfEmpty(): Promise<void> {
  const existing = await db.execute<{ cnt: string }>(sql`
    SELECT COUNT(*) AS cnt
    FROM mrp_price_history
    WHERE variant != 'Standard'
  `);
  const count = Number(existing.rows[0]?.cnt ?? 0);
  if (count > 0) {
    logger.info({ count }, "Variant prices already seeded — skipping");
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const rows = (sanitarywareVariantSeedData as Array<{ itemCode: string; mrp: number; effectiveDate: string; variant: string }>);
  const source = await db
    .select({ id: mrpSourcesTable.id })
    .from(mrpSourcesTable)
    .where(eq(mrpSourcesTable.division, "Ceramic Sanitaryware"))
    .limit(1);
  const sourceId = source[0]?.id;
  if (!sourceId) {
    throw new Error("Ceramic Sanitaryware source must exist before variant seed data is loaded.");
  }
  const seedPayload = JSON.stringify(rows);
  const batch = await db
    .insert(mrpLoadBatchesTable)
    .values({
      sourceId,
      fileName: "Prayag_Sanitaryware_Variant_Prices.xlsx",
      fileSha256: createHash("sha256").update(seedPayload).digest("hex"),
      fileSizeBytes: Buffer.byteLength(seedPayload),
      downloadedAt: today,
      rowCount: rows.length,
      notes: "Application seed: sanitaryware colour-variant prices",
    })
    .returning({ id: mrpLoadBatchesTable.id });
  const loadBatchId = batch[0]?.id;
  if (!loadBatchId) {
    throw new Error("Unable to create provenance batch for sanitaryware variant seed.");
  }

  let inserted = 0;
  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const result = await db
      .insert(mrpPriceHistoryTable)
      .values(
        batch.map((r) => ({
          itemCode: r.itemCode,
          mrp: r.mrp,
          priceBasis: "MRP" as const,
          effectiveDate: r.effectiveDate,
          loadDate: today,
          sourceFile: "Prayag_Sanitaryware_Variant_Prices.xlsx",
          isCurrent: false,
          reviewStatus: "approved" as const,
          loadBatchId,
          variant: r.variant,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: mrpPriceHistoryTable.id });
    inserted += result.length;
  }

  if (inserted > 0) {
    await recomputeCurrentFlags();
  }
  logger.info({ inserted, total: rows.length }, "Sanitaryware variant prices seeded");
}
