import { it, describe, expect, vi } from "vitest";
import { db, catalogProductsTable } from "@workspace/db";
import { sql, eq } from "drizzle-orm";
const fixtureSeed = vi.hoisted(() => ({ products: [] as Array<Record<string, unknown>>, priceHistory: [], conflicts: [] }));
vi.mock("../seed/catalog-seed.json", () => ({ default: fixtureSeed }));
vi.mock("../seed/competitor-seed.json", () => ({ default: { competitors: [] } }));
import { loadCatalogSeed, previewCatalogSeedCategories } from "./catalogSeed";

describe.each(["matched", "new", "two"])("private seed/reset writer: %s", kind => {
  it("previews and writes the preferred spelling; existing classification is preserved", async () => {
    await db.execute(sql`TRUNCATE catalog_products, mrp_price_history, mrp_history_provenance_events, code_conflicts`);
    const base = { productName: "Seed Fixture", division: "Seed Fixture Division", seriesRange: null, size: null,
      uom: "NOS", isActive: true, sourceFiles: null, dataFlag: null };
    await db.insert(catalogProductsTable).values([
      { ...base, itemCode: "OLD", category: "Seed Fittings", seriesRange: "Keep Legacy Range" },
      ...(kind === "two" ? [
        { ...base, itemCode: "OLD2", category: "Seed Fittings" },
        { ...base, itemCode: "OLD3", category: "SEED-FITTING" },
      ] : []),
    ]);
    const raw = kind === "new" ? "Novel Seed Category" : "SEED-FITTING";
    fixtureSeed.products.splice(0, fixtureSeed.products.length,
      { ...base, itemCode: "OLD", category: "Wrong", division: "Wrong", seriesRange: "Wrong" },
      { ...base, itemCode: "NEW", category: raw });
    const preview = await previewCatalogSeedCategories();
    expect(preview.categorySpellings[0]).toMatchObject({ inputCategory: raw,
      selectedCategory: kind === "new" ? raw : "Seed Fittings", status: kind === "new" ? "new" : "matched existing spelling" });
    if (kind === "two") expect(preview.categorySpellings[0]!.candidates.map(row => row.activeProducts)).toEqual([2, 1]);
    await loadCatalogSeed(preview.categorySpellingFingerprint);
    const old = (await db.select().from(catalogProductsTable).where(eq(catalogProductsTable.itemCode, "OLD")))[0]!;
    const created = (await db.select().from(catalogProductsTable).where(eq(catalogProductsTable.itemCode, "NEW")))[0]!;
    expect(old).toMatchObject({ division: base.division, category: "Seed Fittings", seriesRange: "Keep Legacy Range" });
    expect(created.category).toBe(kind === "new" ? raw : "Seed Fittings");
  });
});