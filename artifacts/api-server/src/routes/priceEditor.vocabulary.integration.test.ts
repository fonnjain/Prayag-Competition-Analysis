import express from "express";
import supertest from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  locallyAddedCategoriesTable,
  locallyAddedDivisionsTable,
  locallyAddedSeriesTable,
  catalogProductsTable,
} from "@workspace/db";
import routes from "./index";
import { chooseVocabularyCollision } from "../lib/priceEditorVocabulary";

const token = `P048 ${Date.now().toString(36)}`;
const createdDivisionNames: string[] = [];
const createdCategoryNames: Array<{ division: string; name: string }> = [];
const createdSeriesNames: Array<{ division: string; name: string }> = [];

function requestAs(role?: "admin" | "user") {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => Boolean(role)) as never;
    if (role) {
      req.user = {
        id: `p048-${role}`,
        email: `${role}@p048.example.test`,
        mustChangePassword: false,
        role,
      };
    }
    next();
  });
  app.use(routes);
  return supertest(app);
}

async function immutableCatalogSnapshot() {
  const result = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM catalog_products) AS products,
      (SELECT md5(COALESCE(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), '')) FROM catalog_products p) AS products_digest,
      (SELECT count(*)::int FROM mrp_price_history) AS mrp_rows,
      (SELECT md5(COALESCE(string_agg(to_jsonb(m)::text, '|' ORDER BY m.id), '')) FROM mrp_price_history m) AS mrp_digest,
      (SELECT count(*)::int FROM competitor_prices) AS competitor_rows,
      (SELECT md5(COALESCE(string_agg(to_jsonb(c)::text, '|' ORDER BY c.id), '')) FROM competitor_prices c) AS competitor_digest
  `);
  return result.rows;
}

afterAll(async () => {
  for (const entry of createdCategoryNames) {
    await db.delete(locallyAddedCategoriesTable).where(and(
      eq(locallyAddedCategoriesTable.division, entry.division),
      eq(locallyAddedCategoriesTable.name, entry.name),
    ));
  }
  for (const entry of createdSeriesNames) {
    await db.delete(locallyAddedSeriesTable).where(and(
      eq(locallyAddedSeriesTable.division, entry.division),
      eq(locallyAddedSeriesTable.name, entry.name),
    ));
  }
  for (const name of createdDivisionNames) {
    await db.delete(locallyAddedDivisionsTable).where(eq(locallyAddedDivisionsTable.name, name));
  }
});

describe("P048 price editor vocabulary", () => {
  it("selects a deterministic case variant for a pure two-spelling fixture", () => {
    const fixture = [
      { name: "ALLIED", count: 26 },
      { name: "Allied", count: 26 },
    ];
    expect(chooseVocabularyCollision("allied", fixture)?.name).toBe("Allied");
    expect(chooseVocabularyCollision("ALLIED", fixture)?.name).toBe("ALLIED");
  });

  it("returns Allied for a real normalized series collision in development", async () => {
    const response = await requestAs("admin").post("/catalog/price-editor/series")
      .send({ division: "CP Fittings / Faucets", name: "allied", reason: "P048 normalized collision check" });
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ code: "VOCABULARY_DUPLICATE", existingValue: "Allied" });
  });

  it("requires admin, detects offered/current normalized duplicates, and persists audited additions without product or price mutations", async () => {
    const before = await immutableCatalogSnapshot();
    const admin = requestAs("admin");
    const user = requestAs("user");
    const denied = await user.post("/catalog/price-editor/divisions").send({ name: `${token} no`, reason: "test" });
    expect(denied.status).toBe(403);
    const deniedCategory = await user.post("/catalog/price-editor/categories")
      .send({ division: "Pipes & Fittings", name: `${token} no`, reason: "test" });
    expect(deniedCategory.status).toBe(403);
    const deniedSeries = await user.post("/catalog/price-editor/series")
      .send({ division: "Pipes & Fittings", name: `${token} no`, reason: "test" });
    expect(deniedSeries.status).toBe(403);

    const missingReason = await admin.post("/catalog/price-editor/divisions").send({ name: `${token} missing reason` });
    expect(missingReason.status).toBe(400);
    const symbolsOnly = await admin.post("/catalog/price-editor/divisions")
      .send({ name: "& / -", reason: "not a vocabulary value" });
    expect(symbolsOnly.status).toBe(400);
    const missingCategoryReason = await admin.post("/catalog/price-editor/categories")
      .send({ division: "Pipes & Fittings", name: `${token} missing reason` });
    expect(missingCategoryReason.status).toBe(400);
    const missingSeriesReason = await admin.post("/catalog/price-editor/series")
      .send({ division: "Pipes & Fittings", name: `${token} missing reason` });
    expect(missingSeriesReason.status).toBe(400);

    for (const spelling of ["CPVC Pipe", "cpvc pipe", "CPVC  Pipe", "CPVC-Pipes"]) {
      const collision = await admin.post("/catalog/price-editor/categories")
        .send({ division: "Pipes & Fittings", name: spelling, reason: "existing catalogue collision" });
      expect(collision.status, spelling).toBe(409);
      expect(collision.body).toEqual({ code: "VOCABULARY_DUPLICATE", existingValue: "CPVC Pipe" });
    }

    const options = await admin.get("/catalog/price-editor/new-product/options");
    expect(options.status).toBe(200);
    const offeredDivision = options.body.divisions[0] as string;
    const offeredDivisionDuplicate = await admin.post("/catalog/price-editor/divisions")
      .send({ name: offeredDivision, reason: "duplicate test" });
    expect(offeredDivisionDuplicate.status).toBe(409);
    expect(offeredDivisionDuplicate.body).toEqual({ code: "VOCABULARY_DUPLICATE", existingValue: offeredDivision });
    const offeredDivisionCategories = options.body.byDivision.find((entry: { division: string; categories: string[] }) =>
      entry.categories.length > 0,
    );
    if (offeredDivisionCategories) {
      const offeredCategory = offeredDivisionCategories.categories[0] as string;
      const offeredCategoryDuplicate = await admin.post("/catalog/price-editor/categories")
        .send({ division: offeredDivisionCategories.division, name: offeredCategory, reason: "duplicate test" });
      expect(offeredCategoryDuplicate.status).toBe(409);
      expect(offeredCategoryDuplicate.body).toEqual({ code: "VOCABULARY_DUPLICATE", existingValue: offeredCategory });
    }

    const divisionName = `${token} Pipes`;
    const divisionResponse = await admin.post("/catalog/price-editor/divisions")
      .send({ name: divisionName, reason: "P048 integration audit reason" });
    expect(divisionResponse.status).toBe(201);
    expect(divisionResponse.body).toMatchObject({
      name: divisionName,
      actor: "admin@p048.example.test",
      reason: "P048 integration audit reason",
      salesMapped: false,
      warning: "This division is not known to the Sales application. Products in it will not appear in Sales reporting until it is mapped there.",
    });
    createdDivisionNames.push(divisionName);
    expect(divisionResponse.body.createdAt).toBeTruthy();
    const divisionAudit = await db.select().from(locallyAddedDivisionsTable)
      .where(eq(locallyAddedDivisionsTable.name, divisionName)).limit(1);
    expect(divisionAudit[0]).toMatchObject({
      name: divisionName,
      actor: "admin@p048.example.test",
      reason: "P048 integration audit reason",
      salesMapped: false,
    });

    const normalizedCollision = await admin.post("/catalog/price-editor/divisions")
      .send({ name: `  p048   ${token.slice("P048 ".length)} pipe!  `, reason: "collision test" });
    expect(normalizedCollision.status).toBe(409);
    expect(normalizedCollision.body).toEqual({ code: "VOCABULARY_DUPLICATE", existingValue: divisionName });

    const divisionTwo = `${token} Secondary`;
    const secondDivisionResponse = await admin.post("/catalog/price-editor/divisions")
      .send({ name: divisionTwo, reason: "second division test" });
    expect(secondDivisionResponse.status).toBe(201);
    createdDivisionNames.push(divisionTwo);

    const categoryName = `${token} Fittings`;
    const categoryResponse = await admin.post("/catalog/price-editor/categories")
      .send({ division: divisionName, name: categoryName, reason: "category audit reason" });
    expect(categoryResponse.status).toBe(201);
    expect(categoryResponse.body).toMatchObject({
      division: divisionName,
      name: categoryName,
      actor: "admin@p048.example.test",
      reason: "category audit reason",
    });
    expect(categoryResponse.body).not.toHaveProperty("warning");
    expect(categoryResponse.body.createdAt).toBeTruthy();
    createdCategoryNames.push({ division: divisionName, name: categoryName });
    const categoryAudit = await db.select().from(locallyAddedCategoriesTable).where(and(
      eq(locallyAddedCategoriesTable.division, divisionName),
      eq(locallyAddedCategoriesTable.name, categoryName),
    )).limit(1);
    expect(categoryAudit[0]).toMatchObject({
      division: divisionName,
      name: categoryName,
      actor: "admin@p048.example.test",
      reason: "category audit reason",
    });

    const categoryCollision = await admin.post("/catalog/price-editor/categories")
      .send({ division: divisionName, name: `p048 ${token.slice("P048 ".length)} fitting.`, reason: "collision test" });
    expect(categoryCollision.status).toBe(409);
    expect(categoryCollision.body).toEqual({ code: "VOCABULARY_DUPLICATE", existingValue: categoryName });

    const separatelyScopedCategory = await admin.post("/catalog/price-editor/categories")
      .send({ division: divisionTwo, name: categoryName, reason: "separate scope test" });
    expect(separatelyScopedCategory.status).toBe(201);
    createdCategoryNames.push({ division: divisionTwo, name: categoryName });

    const invalidDivisionCategory = await admin.post("/catalog/price-editor/categories")
      .send({ division: `${token} nonexistent`, name: "No category", reason: "invalid scope test" });
    expect(invalidDivisionCategory.status).toBe(400);

    const updatedOptions = await admin.get("/catalog/price-editor/new-product/options");
    expect(updatedOptions.body.divisions).toContain(divisionName);
    expect(updatedOptions.body.categories).toContain(categoryName);
    expect(updatedOptions.body.byDivision).toContainEqual(expect.objectContaining({
      division: divisionName,
      categories: expect.arrayContaining([categoryName]),
      series: [],
    }));
    expect(updatedOptions.body.locallyAddedDivisions).toContainEqual(expect.objectContaining({
      name: divisionName,
      actor: "admin@p048.example.test",
      reason: "P048 integration audit reason",
      salesMapped: false,
    }));
    expect(updatedOptions.body.salesKnownDivisions).toContain("QUAA & FERN");
    const seriesName = `${token} Local Series`;
    const seriesResponse = await admin.post("/catalog/price-editor/series").send({
      division: divisionName, name: seriesName, reason: "local series audit reason",
    });
    expect(seriesResponse.status).toBe(201);
    expect(seriesResponse.body).toMatchObject({
      division: divisionName, name: seriesName, actor: "admin@p048.example.test",
      reason: "local series audit reason",
    });
    expect(seriesResponse.body.createdAt).toBeTruthy();
    createdSeriesNames.push({ division: divisionName, name: seriesName });
    const seriesAudit = await db.select().from(locallyAddedSeriesTable).where(and(
      eq(locallyAddedSeriesTable.division, divisionName),
      eq(locallyAddedSeriesTable.name, seriesName),
    )).limit(1);
    expect(seriesAudit[0]).toMatchObject({
      division: divisionName, name: seriesName, actor: "admin@p048.example.test",
      reason: "local series audit reason",
    });
    const localSeriesCollision = await admin.post("/catalog/price-editor/series").send({
      division: divisionName, name: seriesName.toLocaleLowerCase("en"), reason: "normalized collision test",
    });
    expect(localSeriesCollision.status).toBe(409);
    expect(localSeriesCollision.body).toEqual({ code: "VOCABULARY_DUPLICATE", existingValue: seriesName });
    const separatelyScopedSeries = await admin.post("/catalog/price-editor/series").send({
      division: divisionTwo, name: seriesName, reason: "separate division scope test",
    });
    expect(separatelyScopedSeries.status).toBe(201);
    createdSeriesNames.push({ division: divisionTwo, name: seriesName });
    const seriesOptions = await admin.get("/catalog/price-editor/new-product/options");
    expect(seriesOptions.body.series).toContain(seriesName);
    expect(seriesOptions.body.byDivision).toContainEqual(expect.objectContaining({
      division: divisionName, series: [seriesName],
    }));
    expect(seriesOptions.body.locallyAddedSeries).toContainEqual(expect.objectContaining({
      division: divisionName, name: seriesName, actor: "admin@p048.example.test",
      reason: "local series audit reason",
    }));
    const emptyVocabularyPreview = await admin.post("/catalog/price-editor/new-product/preview").send({
      itemCode: `P048${Date.now().toString(36).toUpperCase()}`,
      productName: "P048 local vocabulary validation",
      division: divisionName,
      series: seriesName.toLocaleLowerCase("en"),
      category: categoryName,
      mrp: 100,
      effectiveDate: "2099-01-01",
      reason: "Validation only",
      unusualCodeConfirmed: true,
    });
    expect(emptyVocabularyPreview.status).toBe(200);
    const after = await immutableCatalogSnapshot();
    expect(after).toEqual(before);
  });
});