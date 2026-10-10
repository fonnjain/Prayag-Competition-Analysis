import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db, type BucketListRecord } from "@workspace/db";
import { loadBucketWorld, type BucketWorld } from "./bucketLists";
import { BucketError } from "./bucketMembership";
import { competitorImpact, compileCompetitorRules } from "./bucketCompetitors";
import { composedProductAllowed, composedQuoteAllowed, composedProductSql, composedQuoteSql, composedDisclosure, type BucketLayer } from "./bucketComposition";
import { assertEnforcedDelete, assertEnforcedEdit, assertEnforcementAdmin, changeBucketEnforcement } from "./bucketEnforcement";
import { bucketCodeAllowed, bucketCompetitorAllowed, bucketExportRows, withBucketContext as withBucketFilterContext } from "./bucketFilter";
import { EnforceBucketListBody, ReleaseBucketEnforcementBody } from "@workspace/api-zod";

/** No source fixtures/inserts. These tests SELECT the existing catalogue and
 * prices, then exercise only in-memory predicates and read-only SQL. */
let world: BucketWorld, a: string, b: string, brand: string, other: string;
const layer = (type: "included" | "excluded", codes: string[], competitor?: string): BucketLayer => ({
  type, codes: new Set(codes), productFilterApplied: !competitor,
  clauses: competitor ? [{ competitor, codes: null }] : [],
});
beforeAll(async () => {
  world = await loadBucketWorld();
  [a, b] = world.catalogue.filter(p => p.isActive).map(p => p.itemCode);
  [brand, other] = world.competitorNames!;
  if (!a || !b || !brand || !other) throw new Error("Existing catalogue/competitor evidence unavailable.");
});
describe("P053 Step 3 simple company and personal restrictions", () => {
  it("two Included product whitelists intersect", () => {
    const layers = [layer("included", [a, b]), layer("included", [b])];
    expect(composedProductAllowed(layers, a)).toBe(false);
    expect(composedProductAllowed(layers, b)).toBe(true);
  });
  it("personal Included cannot resurrect enforced Excluded", () => {
    expect(composedProductAllowed([layer("excluded", [a]), layer("included", [a])], a)).toBe(false);
  });
  it("personal Excluded restricts enforced Included", () => {
    expect(composedProductAllowed([layer("included", [a, b]), layer("excluded", [b])], b)).toBe(false);
  });
  it("two Excluded sets remove their union", () => {
    const layers = [layer("excluded", [a]), layer("excluded", [b])];
    expect(composedProductAllowed(layers, a)).toBe(false);
    expect(composedProductAllowed(layers, b)).toBe(false);
  });
  it("empty personal layer leaves enforcement intact", () => {
    expect(composedProductAllowed([layer("excluded", [a])], a)).toBe(false);
    expect(composedProductAllowed([layer("excluded", [a])], b)).toBe(true);
  });
  it("two Included competitor whitelists intersect, not union", () => {
    const layers = [layer("included", [], brand), layer("included", [], other)];
    expect(composedQuoteAllowed(layers, brand, a)).toBe(false);
    expect(composedQuoteAllowed(layers, other, a)).toBe(false);
  });
  it("personal competitor inclusion cannot restore company-excluded quote", () => {
    const layers = [layer("excluded", [], brand), layer("included", [], brand)];
    expect(composedQuoteAllowed(layers, brand, a)).toBe(false);
    expect(composedProductAllowed(layers, a)).toBe(true);
  });
  it("company product mask and personal competitor mask apply independently", () => {
    const layers = [layer("excluded", [a]), layer("included", [], brand)];
    expect(composedProductAllowed(layers, a)).toBe(false);
    expect(composedQuoteAllowed(layers, other, b)).toBe(false);
    expect(composedQuoteAllowed(layers, brand, b)).toBe(true);
  });
  it("ALS helpers use both layers", () => {
    withBucketFilterContext({ type: "included", codes: new Set([a]), banner: "test",
      layers: [layer("excluded", [a]), layer("included", [a])] }, () => expect(bucketCodeAllowed(a)).toBe(false));
    withBucketFilterContext({ type: "excluded", codes: new Set(), banner: "test",
      layers: [layer("excluded", [], brand), layer("included", [], brand)] }, () => expect(bucketCompetitorAllowed(brand, a)).toBe(false));
  });
  it("SQL product and quote predicates agree with JavaScript", async () => {
    const layers = [layer("excluded", [a]), layer("included", [a, b])];
    const result = await db.execute<{ code: string; allowed: boolean }>(sql`
      SELECT code, (${composedProductSql(layers, sql`code`)}) AS allowed
      FROM (VALUES (${a}::text),(${b}::text)) data(code)`);
    for (const row of result.rows) expect(row.allowed).toBe(composedProductAllowed(layers, row.code));
    const quoteLayers = [layer("excluded", [], brand), layer("included", [], brand)];
    const quote = await db.execute<{ allowed: boolean }>(sql`SELECT (${composedQuoteSql(quoteLayers, sql`${brand}::text`, sql`${a}::text`)}) AS allowed`);
    expect(quote.rows[0].allowed).toBe(false);
  });
  it("scoped competitor predicates remain independent", () => {
    const force: BucketLayer = { ...layer("excluded", [], brand), clauses: [{ competitor: brand, codes: new Set([a]) }] };
    const personal: BucketLayer = { ...layer("included", [], brand), clauses: [{ competitor: brand, codes: new Set([a, b]) }] };
    expect(composedQuoteAllowed([force, personal], brand, a)).toBe(false);
    expect(composedQuoteAllowed([force, personal], brand, b)).toBe(true);
  });
  it("combined last-quote loss counts each existing product once", () => {
    const rules = [{ competitor: "Sparsh Pearl", scope: "everywhere" as const }];
    const clauses = compileCompetitorRules(rules, world.catalogue);
    const layers = [layer("excluded", [], "Sparsh Pearl"), layer("excluded", [], "Sparsh Pearl")];
    const once = competitorImpact("excluded", rules, world.catalogue, world.quotes!);
    const combined = competitorImpact("excluded", [], world.catalogue, world.quotes!, () => true,
      (name, code) => composedQuoteAllowed(layers, name, code));
    expect(clauses.length).toBe(1);
    expect(once.noCompetitorPriceCount).toBe(150);
    expect(combined.noCompetitorPriceCount).toBe(once.noCompetitorPriceCount);
  });
  it("no restrictions produce zero newly uncovered products", () => {
    expect(competitorImpact("excluded", [], world.catalogue, world.quotes!).noCompetitorPriceCount).toBe(0);
  });
  it("exports name enforced first, personal second with scope and type", () => {
    const text = composedDisclosure({ name: "Company", type: "excluded", count: 2,
      competitorRules: [{ competitor: brand, scope: "category", categories: ["Pipes"] }] },
    { name: "Personal", type: "included", count: 1 });
    expect(text).toContain("Showing: Enforced:");
    expect(text).toContain(" · Also:");
    expect(text).not.toContain("\n");
    expect(text.indexOf("Company")).toBeLessThan(text.indexOf("Personal"));
    expect(text).toContain("Pipes");
    expect(composedDisclosure(null, { name: "Personal", type: "included", count: 1 })).not.toContain("Enforced");
    expect(composedDisclosure(null, null)).toBe("");
  });
  it("non-admin service guards return 403 before enforcing, releasing or clearing", async () => {
    const actor = { id: "reader", admin: false, label: "reader" };
    expect(() => assertEnforcementAdmin(actor)).toThrow(BucketError);
    await expect(changeBucketEnforcement({ listId: "12345678-1234-4234-8234-123456789abc", expectedVersion: 0 }, actor))
      .rejects.toMatchObject({ status: 403 });
    await expect(changeBucketEnforcement({ expectedVersion: 0 }, actor, true))
      .rejects.toMatchObject({ status: 403 });
    await expect(changeBucketEnforcement({ listId: null, expectedVersion: 0 }, actor))
      .rejects.toMatchObject({ status: 403 });
  });
  it("admin edits need no acknowledgement; deletion and non-admin edit stay guarded", () => {
    const parent = { ...world.lists[0], id: "parent", name: "Original", parentId: null };
    const forced = { ...parent, id: "forced", name: "Company", parentId: "parent" };
    const isolated = { ...world, byId: new Map<string, BucketListRecord>([["parent", parent], ["forced", forced]]),
      enforcement: { ...world.enforcement, listId: "forced", version: 1 } } as BucketWorld;
    const admin = { id: "admin", admin: true, label: "admin" };
    expect(assertEnforcedEdit("parent", {}, admin, isolated)).toBe(true);
    expect(assertEnforcedEdit("forced", {}, admin, isolated)).toBe(true);
    expect(() => assertEnforcedEdit("forced", {}, { ...admin, admin: false }, isolated)).toThrow(BucketError);
    expect(() => assertEnforcedDelete("forced", isolated)).toThrow(/Take it out of force/);
    expect(() => assertEnforcedDelete("parent", isolated)).toThrow(/Take it out of force/);
  });
  it("enforce and release contracts require no reason or confirmation", () => {
    expect(EnforceBucketListBody.safeParse({ listId: "12345678-1234-4234-8234-123456789abc", expectedVersion: 0 }).success).toBe(true);
    expect(ReleaseBucketEnforcementBody.safeParse({ expectedVersion: 1 }).success).toBe(true);
  });
  it("an unfiltered export has no bucket banner or empty disclosure", () => {
    const rows = [["item_code", "mrp"], [a, 100]];
    expect(withBucketFilterContext(null, () => bucketExportRows(rows))).toEqual(rows);
  });
  it.each([["Apollo", 67], ["Ashirvad", 84], ["Prince", 217], ["Sparsh Pearl", 150]] as const)(
    "%s last-quote loss matches the existing development reference (%i)", (competitor, expected) => {
      const impact = competitorImpact("excluded", [{ competitor, scope: "everywhere" }], world.catalogue, world.quotes!);
      expect(impact.noCompetitorPriceCount).toBe(expected);
    });
});
