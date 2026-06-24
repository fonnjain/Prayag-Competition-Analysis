import { db } from "@workspace/db";
import {
  productsTable,
  competitorsTable,
  comparisonsTable,
  settingsTable,
} from "@workspace/db";
import seedData from "../seed/seed-data.json";
import { logger } from "./logger";

interface SeedProduct {
  itemCode: string;
  category: string;
  size: string | null;
  prayagMrp: number | null;
  prayagNet: number | null;
}
interface SeedCompetitor {
  name: string;
  basis: string;
}
interface SeedComparison {
  competitor: string;
  itemCode: string;
  basis: string;
  compMrp: number | null;
  compPrice: number | null;
}
interface SeedFile {
  products: SeedProduct[];
  competitors: SeedCompetitor[];
  comparisons: SeedComparison[];
}

const data = seedData as SeedFile;

async function chunkedInsert<T>(
  rows: T[],
  insertFn: (batch: T[]) => Promise<unknown>,
  size = 500,
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    await insertFn(rows.slice(i, i + size));
  }
}

export async function loadSeed(): Promise<void> {
  await db.delete(comparisonsTable);
  await db.delete(productsTable);
  await db.delete(competitorsTable);
  await db.delete(settingsTable);

  await chunkedInsert(data.products, (batch) =>
    db.insert(productsTable).values(
      batch.map((p) => ({
        itemCode: p.itemCode,
        category: p.category,
        size: p.size,
        prayagMrp: p.prayagMrp,
        prayagNet: p.prayagNet,
        kgCost: null,
        edited: false,
      })),
    ),
  );

  await db.insert(competitorsTable).values(
    data.competitors.map((c) => ({
      name: c.name,
      basis: c.basis,
      hidden: false,
    })),
  );

  await chunkedInsert(data.comparisons, (batch) =>
    db.insert(comparisonsTable).values(
      batch.map((c) => ({
        competitor: c.competitor,
        itemCode: c.itemCode,
        basis: c.basis,
        compMrp: c.compMrp,
        compPrice: c.compPrice,
        matchMethod: "code",
        sourceFile: "Prayag_Master_Price_Comparison.xlsx",
        edited: false,
      })),
    ),
  );

  await db.insert(settingsTable).values({ minimumMarginPct: 15 });
}

export async function seedIfEmpty(): Promise<void> {
  const existing = await db.select().from(productsTable).limit(1);
  if (existing.length === 0) {
    logger.info("Seeding Prayag data from master comparison file...");
    await loadSeed();
    logger.info("Seed complete");
  }
}
