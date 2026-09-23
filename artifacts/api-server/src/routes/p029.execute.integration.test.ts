/**
 * Destructive-by-design operational rehearsal for P029.
 *
 * Permanently skipped unless RUN_P029_EXECUTE=true. It uses the real
 * Preview -> Apply route and intentionally leaves the applied classification
 * correction and its provenance in development for inspection.
 */
import express from "express";
import supertest from "supertest";
import { and, isNotNull, isNull, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { catalogProductClassificationCorrectionsTable, db } from "@workspace/db";
import catalogRouter from "./catalogImportExport.js";

process.env.NODE_ENV = "test";

const enabled = process.env.RUN_P029_EXECUTE === "true" ? describe : describe.skip;
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.isAuthenticated = (() => true) as typeof req.isAuthenticated;
  req.user = {
    id: "p029-operational-admin",
    email: "p029-operational-admin@internal",
    role: "admin",
    mustChangePassword: false,
  };
  next();
});
app.use(catalogRouter);
const request = supertest(app);

async function snapshot(table: "mrp_price_history" | "competitor_prices" | "competitor_price_staging") {
  const result = await db.execute<{ count: number | string; digest: string }>(sql.raw(
    `SELECT count(*)::int AS count, md5(coalesce(string_agg(row_to_json(t)::text, '' ORDER BY t.id), '')) AS digest FROM ${table} t`,
  ));
  return {
    count: Number(result.rows[0]?.count ?? 0),
    digest: result.rows[0]?.digest ?? "",
  };
}

enabled("P029 execute rehearsal", () => {
  it("previews and applies the classification-only repair without protected-table changes", async () => {
    const staleNoopCorrections = await db
      .selectDistinct({
        correctionKey: catalogProductClassificationCorrectionsTable.correctionKey,
      })
      .from(catalogProductClassificationCorrectionsTable)
      .where(and(
        isNotNull(catalogProductClassificationCorrectionsTable.appliedAt),
        isNull(catalogProductClassificationCorrectionsTable.undoneAt),
        sql`${catalogProductClassificationCorrectionsTable.previousValues} = ${catalogProductClassificationCorrectionsTable.correctedValues}`,
      ));
    const protectedBefore = await Promise.all([
      snapshot("mrp_price_history"),
      snapshot("competitor_prices"),
      snapshot("competitor_price_staging"),
    ]);
    const preview = await request.post("/catalog/ugd-classification/preview").send({});
    expect(preview.status).toBe(200);
    expect(preview.body.rows).toHaveLength(10);
    expect(preview.body.priceChecks.every((row: { matches: boolean }) => row.matches)).toBe(true);

    const applied = await request
      .post(`/catalog/ugd-classification/${preview.body.correctionKey}/apply`)
      .send({});
    expect(applied.status).toBe(200);
    expect(applied.body).toMatchObject({ status: "applied", changed: 10 });

    for (const stale of staleNoopCorrections) {
      const undone = await request
        .post(`/catalog/ugd-classification/${stale.correctionKey}/undo`)
        .send({});
      expect(undone.status, JSON.stringify(undone.body)).toBe(200);
      expect(undone.body).toMatchObject({ status: "undone", restored: 0, alreadyRestored: true });
    }

    const classification = await db.execute<{
      item_code: string;
      sibling_code: string;
      target_values: string;
      sibling_values: string;
    }>(sql`
      WITH pairs(sibling_code, item_code) AS (
        VALUES
          ('U-11C', 'U-11CS'), ('U-12C', 'U-12CS'), ('U-13C', 'U-13CS'),
          ('U-14C', 'U-14CS'), ('U-15C', 'U-15CS'), ('U-16C', 'U-16CS'),
          ('U-11B', 'U-11BS'), ('U-12B', 'U-12BS'), ('U-13B', 'U-13BS'),
          ('U-14B', 'U-14BS')
      )
      SELECT p.item_code, p.sibling_code,
        jsonb_build_array(t.division, t.category, t.series_range, t.size, t.uom, t.kg_cost)::text AS target_values,
        jsonb_build_array(s.division, s.category, s.series_range, s.size, s.uom, s.kg_cost)::text AS sibling_values
      FROM pairs p
      JOIN catalog_products t ON t.item_code = p.item_code
      JOIN catalog_products s ON s.item_code = p.sibling_code
      ORDER BY p.item_code
    `);
    expect(classification.rows).toHaveLength(10);
    expect(classification.rows.every((row) => row.target_values === row.sibling_values)).toBe(true);
    expect(await Promise.all([
      snapshot("mrp_price_history"),
      snapshot("competitor_prices"),
      snapshot("competitor_price_staging"),
    ])).toEqual(protectedBefore);
  });
});