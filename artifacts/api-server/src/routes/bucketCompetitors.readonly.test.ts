import { beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";
import analysis from "./analysis";
import comparison from "./comparison";
import priceFinder from "./priceFinder";
import { loadBucketWorld, describeBucket, type BucketWorld } from "../lib/bucketLists";
import { compileCompetitorRules } from "../lib/bucketCompetitors";
import { withBucketContext } from "../lib/bucketFilter";
import type { BucketRule } from "@workspace/db";

// These exercise real development SELECTs without users, preferences, list
// records, source fixtures, import staging, or any database insert/update/delete.
describe("P053 real-data read-only source filtering", () => {
  let world: BucketWorld;
  beforeAll(async () => { world = await loadBucketWorld(); });
  const app = (rules: BucketRule[], type: "included" | "excluded" = "excluded") => {
    const clauses = compileCompetitorRules(rules, world.catalogue);
    const instance = express();
    instance.use((_, __, next) => withBucketContext({
      type, codes: new Set(), productFilterApplied: false, clauses, banner: "Read-only test",
      exportBanner: rules.map(r => `${r.competitor} excluded ${r.scope === "everywhere" ? "everywhere" : `in ${(r.divisions ?? r.categories ?? []).join(", ")}`}`).join("; "),
      noCompetitorPriceCount: describeBucket({ parentId: null, rules, addedCodes: [], removedCodes: [], type }, world, { id: "unused", label: "unused", admin: false }).noCompetitorPriceCount,
    }, next));
    instance.use(analysis).use(comparison).use(priceFinder);
    return instance;
  };
  const competitorNames = (data: unknown): string[] => {
    if (Array.isArray(data)) return data.flatMap(competitorNames);
    if (!data || typeof data !== "object") return [];
    return Object.entries(data).flatMap(([key, value]) => {
      if (key === "competitor" && typeof value === "string") return [value];
      if (key === "competitors" && Array.isArray(value)) return value.flatMap(v => typeof v === "string" ? [v] : competitorNames(v));
      return competitorNames(value);
    });
  };
  it("removes Apollo before every overview, brand/category, positioning, coverage and ranking reducer", async () => {
    const unfiltered = app([]);
    const baseline = await request(unfiltered).get("/analysis/overview");
    const filtered = app([{ competitor: "Apollo", scope: "everywhere" }]);
    const overview = await request(filtered).get("/analysis/overview");
    expect(baseline.status).toBe(200); expect(overview.status).toBe(200);
    expect(overview.body.competitorCount).toBe(baseline.body.competitorCount - 1);
    expect(overview.body.totalSkus).toBeLessThan(baseline.body.totalSkus);
    for (const route of ["/analysis/by-brand", "/analysis/by-category", "/analysis/positioning", "/analysis/coverage-matrix", "/analysis/opportunities",
      "/catalog/comparison/summary", "/catalog/comparison/by-product", "/catalog/comparison/matrix", "/catalog/comparison/filters"]) {
      const result = await request(filtered).get(route);
      expect(result.status, route).toBe(200);
      expect(competitorNames(result.body), route).not.toContain("Apollo");
    }
  }, 60000);
  it("computes 67 Apollo and 150 Sparsh losses; keeps existing per-product no-competitor omission", async () => {
    const define = (competitor: string) => describeBucket({ parentId: null, addedCodes: [], removedCodes: [], rules: [{ competitor, scope: "everywhere" }], type: "excluded" }, world, { id: "unused", admin: false, label: "unused" });
    expect(define("Apollo").noCompetitorPriceCount).toBe(67);
    expect(define("Sparsh Pearl").noCompetitorPriceCount).toBe(150);
    expect(define("Sparsh Pearl").productFilterApplied).toBe(false);
    const before = await request(app([])).get("/catalog/comparison/by-product?pageSize=200");
    const after = await request(app([{ competitor: "Sparsh Pearl", scope: "everywhere" }])).get("/catalog/comparison/by-product?pageSize=200");
    expect(after.status).toBe(200);
    expect(after.body.total).toBe(before.body.total - 150);
    expect(competitorNames(after.body)).not.toContain("Sparsh Pearl");
  }, 60000);
  it("normalizes category scope and respects additive rules on live stored products", async () => {
    const rules: BucketRule[] = [{ competitor: "Sparsh Pearl", scope: "category", categories: ["BLACK  PEARL"] }];
    const after = await request(app(rules)).get("/analysis/by-brand");
    const everywhere = await request(app([{ competitor: "Sparsh Pearl", scope: "everywhere" }])).get("/analysis/by-brand");
    expect(after.status).toBe(200); expect(everywhere.status).toBe(200);
    expect(competitorNames(after.body)).toContain("Sparsh Pearl");
    expect(competitorNames(everywhere.body)).not.toContain("Sparsh Pearl");
    const rule = { competitor: "Apollo", scope: "division" as const, divisions: ["Pipes & Fittings"] };
    const scoped = await request(app([rule, { competitor: "Apollo", scope: "category", categories: ["CPVC Pipe"] }])).get("/analysis/overview");
    const all = await request(app([{ competitor: "Apollo", scope: "everywhere" }])).get("/analysis/overview");
    expect(scoped.body).toEqual(all.body);
  }, 60000);
  it("produces actual CSV and XLSX full disclosures with the computed loss count", async () => {
    const filtered = app([{ competitor: "Apollo", scope: "everywhere" }]);
    const target = path.resolve("../../reports/p053-step3-build/exports");
    fs.mkdirSync(target, { recursive: true });
    const csv = await request(filtered).get("/analysis/export?format=csv");
    expect(csv.status).toBe(200); expect(csv.text).toContain("Apollo excluded everywhere");
    expect(csv.text).toContain("67 products have no competitor price under this filter");
    fs.writeFileSync(path.join(target, "apollo-excluded.csv"), csv.text);
    const xlsx = await request(filtered).get("/analysis/export?format=xlsx").buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = []; res.on("data", chunk => chunks.push(Buffer.from(chunk)));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(xlsx.status).toBe(200);
    const book = XLSX.read(xlsx.body, { type: "buffer" });
    const text = JSON.stringify(XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1 }));
    expect(text).toContain("Apollo excluded everywhere");
    expect(text).toContain("67 products have no competitor price under this filter");
    fs.writeFileSync(path.join(target, "apollo-excluded.xlsx"), xlsx.body);
  }, 60000);
});
