import express from "express";
import supertest from "supertest";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { afterAll, expect, it } from "vitest";
import { db, pool, bucketListsTable, bucketPreferencesTable, bucketEnforcementTable, bucketEnforcementHistoryTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import routes from "./routes/index";
import { loadBucketWorld } from "./lib/bucketLists";
import { isLiveBucketProduct } from "./lib/bucketMembership";
import type { Server } from "node:http";

// Real API/resolver in an isolated development schema with explicitly labelled
// fixture identities. Never imported by the app, never a production auth path.
let server: Server;
afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
});
it("serves Step 6 owner-tab and move checks without mutating public data", async () => {
  expect((await db.execute(sql`SELECT current_schema() schema`)).rows[0].schema).toMatch(/^p051_suite_/);
  const snapshot = async () => (await pool.query(`SELECT
    (SELECT md5(string_agg(row_to_json(p)::text,'|' ORDER BY id)) FROM public.catalog_products p) catalogue,
    (SELECT md5(string_agg(row_to_json(p)::text,'|' ORDER BY id)) FROM public.mrp_price_history p) mrp,
    (SELECT md5(string_agg(row_to_json(p)::text,'|' ORDER BY id)) FROM public.competitor_prices p) competitors,
    (SELECT md5(string_agg(row_to_json(p)::text,'|' ORDER BY id)) FROM public.bucket_lists p) lists,
    (SELECT md5(string_agg(row_to_json(p)::text,'|' ORDER BY user_id)) FROM public.bucket_preferences p) preferences,
    (SELECT md5(string_agg(row_to_json(p)::text,'|' ORDER BY id)) FROM public.bucket_enforcement p) enforcement`)).rows[0];
  const before = await snapshot();
  await db.delete(bucketPreferencesTable);
  await db.update(bucketEnforcementTable).set({listId:null}).where(sql`id=1`);
  await db.delete(bucketEnforcementHistoryTable);
  await db.delete(bucketListsTable);
  const codes = (await loadBucketWorld()).catalogue.filter(p => isLiveBucketProduct(p) && !p.itemCode.startsWith("__")).slice(0,4).map(p => p.itemCode);
  const app = express();
  app.use(express.json());
  app.use((req,res,next) => {
    const requested = req.header("x-step6-test-actor") ?? "admin";
    const actor = ["admin","other-admin","user","fresh"].includes(requested) ? requested : "admin";
    req.isAuthenticated = (() => true) as never;
    req.user = {id:`step6-browser-${actor}`,role:actor.includes("admin")?"admin":"user",
      firstName:actor==="user"?"Jordan":actor==="other-admin"?"Casey":"Avery",lastName:actor==="user"?"User":"Admin",email:`step6-${actor}@example.test`,
      profileImageUrl:null,mustChangePassword:false} as never;
    if (req.path.startsWith("/api/activity") || (["POST","PUT","PATCH","DELETE"].includes(req.method) && !req.path.startsWith("/api/bucket-lists")))
      return res.status(204).end();
    return next();
  });
  app.use("/api",routes);
  const create = async (name:string, visibility:string, type:string, actor="admin", extra={}) => {
    const r = await supertest(app).post("/api/bucket-lists").set("x-step6-test-actor",actor).send({
      name,visibility,type,addedCodes:codes.slice(0,2),removedCodes:[],rules:[],...extra,
    }).expect(201);
    return {id:r.body.id,name:r.body.name};
  };
  const creatorList = await create("Creator review","only_me","excluded","user");
  await supertest(app).post(`/api/bucket-lists/${creatorList.id}/move-to-ho`).set("x-step6-test-actor","admin").expect(200);
  const sharedExcluded = await create("Shared pipes","everyone","excluded","other-admin");
  const sharedIncluded = await create("Shared fittings","everyone","included");
  const myExcluded = await create("My supplier","only_me","excluded","admin",{addedCodes:[],rules:[{competitor:"Ashirvad",scope:"everywhere"}]});
  const myIncluded = await create("My review","only_me","included");
  const foreignPrivate = await create("Other admin secret","only_me","excluded","other-admin");
  const userPrivate = await create("User private","only_me","excluded","user");
  await new Promise<void>(resolve => { server=app.listen(0,"127.0.0.1",()=>resolve()); });
  const port=(server.address() as {port:number}).port;
  const dir="../../generated-artifacts/p053-step7";
  await mkdir(dir,{recursive:true});
  await writeFile(`${dir}/browser-context.json`,JSON.stringify({port,codes,creatorList,sharedExcluded,sharedIncluded,myExcluded,myIncluded,foreignPrivate,userPrivate},null,2));
  console.log(`P053_STEP6_PRIVATE_BROWSER_READY port=${port}`);
  const deadline=Date.now()+1200000;
  while(Date.now()<deadline) {
    try {await stat(`${dir}/browser-complete`);break;} catch {}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  expect(await snapshot()).toEqual(before);
});
