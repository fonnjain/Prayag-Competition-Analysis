import express from "express";
import supertest from "supertest";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { afterAll, expect, it } from "vitest";
import { db, pool, bucketPreferencesTable, bucketEnforcementTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import routes from "./routes/index";
import { loadBucketWorld } from "./lib/bucketLists";
import { isLiveBucketProduct } from "./lib/bucketMembership";
import type { Server } from "node:http";

// Browser presentation harness ONLY. The application routes and resolver are
// real; identities are explicitly isolated test actors, not workspace sessions.
// No fixture endpoint is mounted in the application or in production.
let server: Server;
afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
});
it("serves the Step 5 browser pass from a disposable private schema", async () => {
  expect((await db.execute(sql`SELECT current_schema() AS schema`)).rows[0].schema).toMatch(/^p051_suite_/);
  const protectedSnapshot = async () => (await pool.query(`SELECT
    (SELECT md5(string_agg(row_to_json(p)::text,'|' ORDER BY id)) FROM public.catalog_products p) AS catalogue,
    (SELECT md5(string_agg(row_to_json(p)::text,'|' ORDER BY id)) FROM public.mrp_price_history p) AS mrp,
    (SELECT md5(string_agg(row_to_json(p)::text,'|' ORDER BY id)) FROM public.competitor_prices p) AS competitor`)).rows[0];
  const before = await protectedSnapshot();
  await db.delete(bucketPreferencesTable);
  await db.update(bucketEnforcementTable).set({ listId: null }).where(sql`id=1`);
  const world = await loadBucketWorld();
  const products = world.catalogue.filter(p => isLiveBucketProduct(p));
  const brands = new Map<string, Set<string>>();
  for (const q of world.quotes ?? []) {
    if (!q.matchedPrayagCode || q.price == null || !(q.price > 0)) continue;
    const set = brands.get(q.matchedPrayagCode) ?? new Set<string>();
    set.add(q.competitor); brands.set(q.matchedPrayagCode, set);
  }
  const ash = products.find(p => brands.get(p.itemCode)?.size === 1 && brands.get(p.itemCode)?.has("Ashirvad"))!;
  const sparsh = products.find(p => brands.get(p.itemCode)?.size === 1 && brands.get(p.itemCode)?.has("Sparsh Pearl"))!;
  expect(ash).toBeTruthy(); expect(sparsh).toBeTruthy();
  const extra = products.filter(p => ![ash.itemCode, sparsh.itemCode].includes(p.itemCode)).slice(0, 2);
  const codes = [extra[0].itemCode, ash.itemCode, extra[1].itemCode, sparsh.itemCode];
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const actor = req.headers["x-step5-test-actor"] === "admin" ? "admin"
      : req.headers["x-step5-test-actor"] === "fresh" ? "fresh" : "owner";
    req.isAuthenticated = (() => true) as never;
    req.user = { id: `step5-browser-${actor}`, role: actor === "admin" ? "admin" : "user",
      firstName: "Step5", lastName: "Isolated test", email: `step5-${actor}@example.test`,
      profileImageUrl: null, mustChangePassword: false } as never;
    // Suppress telemetry and every non-bucket mutation in the test harness.
    if (req.path.startsWith("/api/activity") || (req.method !== "GET" && !req.path.startsWith("/api/bucket-lists"))) {
      res.status(204).end(); return;
    }
    next();
  });
  app.use("/api", routes);
  const create = async (name: string, type: string, addedCodes: string[], extra = {}, actor = "owner") => {
    const result = await supertest(app).post("/api/bucket-lists").set("x-step5-test-actor", actor)
      .send({ name, type, visibility: "only_me", addedCodes, removedCodes: [], rules: [], ...extra });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    return { id: result.body.id, name };
  };
  const excludedProducts = await create("Excluded products — test", "excluded", [codes[0]]);
  const excludedCompetitor = await create("Ignore Ashirvad — test", "excluded", [], { rules: [{ competitor: "Ashirvad", scope: "everywhere" }] });
  const included = await create("Included sample — test", "included", codes);
  const includedSecond = await create("Second Included — test", "included", [codes[3]]);
  const company = await create("Company restriction — test", "excluded", [codes[2]], { visibility: "everyone" }, "admin");
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  const port = (server.address() as { port: number }).port;
  const dir = "../../generated-artifacts/p053-step5";
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/browser-context.json`, JSON.stringify({ port, codes,
    excludedProducts, excludedCompetitor, included, includedSecond, company }, null, 2));
  console.log(`P053_STEP5_PRIVATE_BROWSER_READY port=${port}`);
  // The tester creates this marker after exporting and saving screenshots.
  const deadline = Date.now() + 540000;
  while (Date.now() < deadline) {
    try { await stat(`${dir}/browser-complete`); break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  expect(await protectedSnapshot()).toEqual(before);
});
