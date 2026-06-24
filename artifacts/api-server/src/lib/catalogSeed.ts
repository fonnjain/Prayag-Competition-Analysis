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
        size: p.size,
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
