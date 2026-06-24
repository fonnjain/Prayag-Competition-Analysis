import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  catalogProductsTable,
  mrpPriceHistoryTable,
  codeConflictsTable,
  competitorPricesTable,
} from "@workspace/db";
import catalogSeedData from "../seed/catalog-seed.json";
import competitorSeedData from "../seed/competitor-seed.json";
import { logger } from "./logger";
import { recomputeCurrentFlags } from "./catalog";
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
  await db.delete(mrpPriceHistoryTable);
  await db.delete(catalogProductsTable);
  await db.delete(codeConflictsTable);
  await db.delete(competitorPricesTable);

  await chunkedInsert(data.products, (batch) =>
    db.insert(catalogProductsTable).values(
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

  await chunkedInsert(data.priceHistory, (batch) =>
    db.insert(mrpPriceHistoryTable).values(
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
    ),
  );

  if (data.conflicts.length > 0) {
    await db.insert(codeConflictsTable).values(
      data.conflicts.map((c) => ({
        itemCode: c.itemCode,
        conflictingNames: c.conflictingNames,
        sources: c.sources,
      })),
    );
  }

  await chunkedInsert(competitorData.competitors, (batch) =>
    db.insert(competitorPricesTable).values(
      batch.map((c) => ({
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
      })),
    ),
  );

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
