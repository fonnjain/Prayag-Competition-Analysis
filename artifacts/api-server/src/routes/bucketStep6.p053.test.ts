import express from "express";
import supertest from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool, bucketListsTable, bucketPreferencesTable, bucketEnforcementTable, bucketEnforcementHistoryTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import routes from "./index";
import { loadBucketWorld } from "../lib/bucketLists";
import { isLiveBucketProduct } from "../lib/bucketMembership";
import { applyApprovedBucketNameCorrection, plumbingListCorrection } from "../lib/bucketNameCorrection";

// All mutations stay in the disposable schema; the public source hash is checked.
function requester(id: string, role: "admin" | "user") {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => true) as never;
    req.user = { id, role, firstName: id === "step6-user" ? "Jordan" : "Avery", lastName: id === "step6-user" ? "User" : "Admin", email: `${id}@example.test`, mustChangePassword: false } as never;
    next();
  });
  app.use("/api", routes);
  return supertest(app);
}
const admin = requester("step6-admin", "admin"), otherAdmin = requester("step6-other-admin", "admin");
const user = requester("step6-user", "user");
let codes: string[], sourceBefore: unknown;
const sourceSnapshot = async () => (await pool.query(`SELECT
  (SELECT md5(string_agg(row_to_json(p)::text,'|' ORDER BY id)) FROM public.catalog_products p) catalogue,
  (SELECT md5(string_agg(row_to_json(p)::text,'|' ORDER BY id)) FROM public.mrp_price_history p) mrp,
  (SELECT md5(string_agg(row_to_json(p)::text,'|' ORDER BY id)) FROM public.competitor_prices p) competitors`)).rows[0];
const create = async (name: string, visibility = "only_me", type = "excluded", client = admin, extra = {}) => {
  const r = await client.post("/api/bucket-lists").send({
    name, visibility, type, addedCodes: codes.slice(0, 2), removedCodes: [], rules: [], ...extra,
  }).expect(201);
  return r.body;
};
const select = (id: string, client = user) => client.put("/api/bucket-lists/active").send({listId: id}).expect(200);
const listIds = async (owner = "all", type = "all", client = admin) =>
  (await client.get("/api/bucket-lists").query({owner,type}).expect(200)).body.map((l: any) => l.id).sort();
const enforce = async (id: string, client = admin) => {
  const s = await client.get("/api/bucket-lists/enforcement").expect(200);
  return client.post("/api/bucket-lists/enforcement").send({listId:id,expectedVersion:s.body.version}).expect(200);
};
beforeAll(async () => {
  expect((await db.execute(sql`SELECT current_schema() schema`)).rows[0].schema).toMatch(/^p051_suite_/);
  sourceBefore = await sourceSnapshot();
  codes = (await loadBucketWorld()).catalogue.filter(p => isLiveBucketProduct(p) && !p.itemCode.startsWith("__")).slice(0, 184).map(p => p.itemCode);
  expect(codes).toHaveLength(184);
});
beforeEach(async () => {
  await db.delete(bucketPreferencesTable);
  await db.update(bucketEnforcementTable).set({listId:null}).where(sql`id=1`);
  await db.delete(bucketEnforcementHistoryTable);
  await db.delete(bucketListsTable);
});
afterAll(async () => expect(await sourceSnapshot()).toEqual(sourceBefore));

describe("P053 Step 6 ownership, privacy and atomic publication", () => {
  it("owner tabs are disjoint, All is their union, and type applies with AND", async () => {
    const sharedEx = await create("Shared excluded","everyone");
    const sharedIn = await create("Shared included","everyone","included",otherAdmin);
    const privateEx = await create("My excluded");
    const privateIn = await create("My included","only_me","included");
    const foreign = await create("Foreign private","only_me","excluded",otherAdmin);
    const ho = await listIds("ho"), mine = await listIds("mine"), all = await listIds();
    expect(ho).toEqual([sharedEx.id,sharedIn.id].sort());
    expect(mine).toEqual([privateEx.id,privateIn.id].sort());
    expect(all).toEqual([...ho,...mine,foreign.id].sort());
    expect(new Set(all).size).toBe(all.length);
    expect(await listIds("mine","excluded")).toEqual([privateEx.id]);
    expect(await listIds("ho","included")).toEqual([sharedIn.id]);
    expect(await listIds("mine","included")).toEqual([privateIn.id]);
  });
  it("admins see every user's private list with owner; non-admins cannot inspect another private list", async () => {
    const foreign = await create("User secret","only_me","excluded",user);
    for (const client of [admin,otherAdmin]) {
      expect(await listIds("all","all",client)).toContain(foreign.id);
      for (const tab of ["ho","mine"]) expect(await listIds(tab,"all",client)).not.toContain(foreign.id);
      const r = await client.get(`/api/bucket-lists/${foreign.id}`).expect(200);
      expect(r.body.ownerName).toBe("Jordan User");
      expect(r.body.canEdit).toBe(true);
    }
    const secret = await create("Another person's private");
    await user.get(`/api/bucket-lists/${secret.id}`).expect(404);
    await user.patch(`/api/bucket-lists/${secret.id}`).send({name:"Stolen"}).expect(404);
    await user.delete(`/api/bucket-lists/${secret.id}`).expect(404);
  });
  it("non-admins cannot use either move endpoint or publish through the editor/enforcement", async () => {
    const own = await create("User private","only_me","excluded",user);
    for (const action of ["move-to-ho","move-to-my"]) await user.post(`/api/bucket-lists/${own.id}/${action}`).expect(403);
    await user.patch(`/api/bucket-lists/${own.id}`).send({visibility:"everyone"}).expect(403);
    await user.post("/api/bucket-lists/enforcement").send({listId:own.id,expectedVersion:0}).expect(403);
  });
  it("private to HO preserves id, complete item/competitor definition and existing preference", async () => {
    const own = await create("Mixed private","only_me","excluded",admin,{
      rules:[{competitor:"Ashirvad",scope:"everywhere"}],
    });
    await select(own.id,admin);
    const before = (await db.select().from(bucketListsTable).where(sql`id=${own.id}::uuid`))[0];
    const r = await admin.post(`/api/bucket-lists/${own.id}/move-to-ho`).expect(200);
    expect(r.body.message).toBe('"Mixed private" is now an HO list, visible to everyone.');
    const after = (await db.select().from(bucketListsTable).where(sql`id=${own.id}::uuid`))[0];
    for (const key of ["id","rules","addedCodes","removedCodes","observedCodes","parentId","createdAt","createdBy"])
      expect(after[key as keyof typeof after]).toEqual(before[key as keyof typeof before]);
    expect(after.visibility).toBe("everyone");
    expect((await admin.get("/api/bucket-lists/active")).body.excluded[0].id).toBe(own.id);
    expect(await listIds("ho")).toContain(own.id);
    expect(await listIds("mine")).not.toContain(own.id);
  });
  it("shared to private changes owner on the same list; other active users retain only filter use", async () => {
    const shared = await create("Taken shared","everyone");
    await select(shared.id,user);
    await select(shared.id,admin);
    const r = await otherAdmin.post(`/api/bucket-lists/${shared.id}/move-to-my`).expect(200);
    expect(r.body.list.id).toBe(shared.id); expect(r.body.list.ownerId).toBe("step6-other-admin");
    expect(await listIds("mine","all",otherAdmin)).toContain(shared.id);
    expect(await listIds("all","all",admin)).toContain(shared.id);
    await admin.get(`/api/bucket-lists/${shared.id}`).expect(200);
    for (const client of [user]) {
      expect(await listIds("all","all",client)).not.toContain(shared.id);
      await client.get(`/api/bucket-lists/${shared.id}`).expect(404);
      const a = await client.get("/api/bucket-lists/active").expect(200);
      expect(a.body.excluded[0].id).toBe(shared.id);
      await client.get(`/api/catalog/products/${encodeURIComponent(codes[0])}`).expect(404);
      await client.put("/api/bucket-lists/active").send({listId:shared.id,active:false}).expect(200);
      expect((await client.get("/api/bucket-lists/active")).body.personalLists).toEqual([]);
      await client.put("/api/bucket-lists/active").send({listId:shared.id,active:true}).expect(404);
    }
  });
  it("retained use survives selecting another exclusion, Included and legacy singleton preferences", async () => {
    const shared = await create("Retained included","everyone","included");
    await db.insert(bucketPreferencesTable).values({userId:"step6-user",activeListId:shared.id});
    await otherAdmin.post(`/api/bucket-lists/${shared.id}/move-to-my`).expect(200);
    const excluded = await create("User other exclusion","only_me","excluded",user,{addedCodes:[codes[1]]});
    await select(excluded.id);
    const a = (await user.get("/api/bucket-lists/active")).body;
    expect(a.included.id).toBe(shared.id); expect(a.excluded[0].id).toBe(excluded.id);
    await user.put("/api/bucket-lists/active").send({listId:null}).expect(200);
    expect((await user.get("/api/bucket-lists/active")).body.personalLists).toEqual([]);
  });
  it("a list in force cannot move private; history is unchanged on refusal and preserved after release/move", async () => {
    const shared = await create("Company enforced","everyone");
    await enforce(shared.id);
    const before = (await admin.get("/api/bucket-lists/enforcement")).body;
    const r = await otherAdmin.post(`/api/bucket-lists/${shared.id}/move-to-my`).expect(409);
    expect(r.body.error).toMatch(/Take it out of force/);
    expect((await admin.get("/api/bucket-lists/enforcement")).body).toEqual(before);
    await admin.post("/api/bucket-lists/enforcement/release").send({expectedVersion:before.version}).expect(200);
    const history = (await admin.get("/api/bucket-lists/enforcement")).body.history;
    await otherAdmin.post(`/api/bucket-lists/${shared.id}/move-to-my`).expect(200);
    expect((await admin.get("/api/bucket-lists/enforcement")).body.history).toEqual(history);
  });
  it("enforcing an owned private list atomically publishes it with a notice, one company layer and no personal clear", async () => {
    const own = await create("CP review");
    const r = await enforce(own.id);
    expect(r.body.enforced.list.id).toBe(own.id);
    expect(r.body.enforced.list.visibility).toBe("everyone");
    expect(r.body.message).toBe('"CP review" is in force, and is now an HO list so everyone can see what is being applied.');
    expect(await listIds("ho")).toContain(own.id); expect(await listIds("mine")).not.toContain(own.id);
    const a = await user.get("/api/bucket-lists/active").expect(200);
    expect(a.body.enforced.id).toBe(own.id); expect(a.body.personalLists).toEqual([]);
    await user.put("/api/bucket-lists/active").send({listId:own.id,active:false}).expect(403);
  });
  it("stale enforcement refuses without publishing the private list", async () => {
    const own = await create("Stay private");
    await admin.post("/api/bucket-lists/enforcement").send({listId:own.id,expectedVersion:999}).expect(409);
    expect((await admin.get(`/api/bucket-lists/${own.id}`)).body.visibility).toBe("only_me");
  });
  it("destination name conflict refuses atomically; wrong query shapes refuse", async () => {
    const shared = await create("Duplicate name","everyone");
    await create("Duplicate name","only_me","excluded",otherAdmin);
    await otherAdmin.post(`/api/bucket-lists/${shared.id}/move-to-my`).expect(409);
    expect((await admin.get(`/api/bucket-lists/${shared.id}`)).body.visibility).toBe("everyone");
    await admin.get("/api/bucket-lists?owner[]=mine").expect(400);
    await admin.get("/api/bucket-lists?type=invalid").expect(400);
  });
  it("repairs the approved rename's person without altering its timestamp or 184 items", async () => {
    const [owner] = (await db.execute<{id:string; person:string}>(sql`SELECT id, concat_ws(' ',first_name,last_name) person FROM users WHERE role='admin' AND concat_ws(' ',first_name,last_name)<>'' LIMIT 1`)).rows;
    expect(owner).toBeDefined();
    const target = await create(plumbingListCorrection.after,"everyone","excluded",admin,{addedCodes:codes});
    await db.update(bucketListsTable).set({id:plumbingListCorrection.id,ownerId:owner.id,createdBy:owner.person,updatedBy:"Approved list-name correction"}).where(sql`id=${target.id}::uuid`);
    const before = (await db.select().from(bucketListsTable).where(sql`id=${plumbingListCorrection.id}::uuid`))[0];
    expect(await applyApprovedBucketNameCorrection()).toEqual({changed:1,id:plumbingListCorrection.id});
    const after = (await db.select().from(bucketListsTable).where(sql`id=${plumbingListCorrection.id}::uuid`))[0];
    expect(after.name).toBe(plumbingListCorrection.after);
    expect(after.updatedBy).toBe(owner.person);
    for (const key of ["id","nameKey","ownerId","visibility","rules","addedCodes","removedCodes","observedCodes","parentId","createdAt","updatedAt"])
      expect(after[key as keyof typeof after]).toEqual(before[key as keyof typeof before]);
    expect(after.addedCodes).toHaveLength(184);
    expect(await applyApprovedBucketNameCorrection()).toEqual({changed:0});
    expect((await db.select().from(bucketEnforcementTable))[0].listId).toBeNull();
  });
  it("non-admin private CRUD, HO-derived copy and explicit publish refusals", async () => {
    await user.post("/api/bucket-lists").send({name:"Forbidden shared",visibility:"everyone"}).expect(403);
    const own = await create("User work","only_me","excluded",user);
    const renamed = await user.patch(`/api/bucket-lists/${own.id}`).send({name:"User renamed"}).expect(200);
    expect(renamed.body.visibility).toBe("only_me");
    expect(renamed.body.updatedBy).toBe("Jordan User");
    await user.delete(`/api/bucket-lists/${own.id}`).expect(200);
    const shared = await create("Company original","everyone");
    const copy = await create("My copy","only_me","excluded",user,{parentId:shared.id});
    expect(copy.visibility).toBe("only_me"); expect(copy.id).not.toBe(shared.id);
    await user.post("/api/bucket-lists/enforcement/release").send({expectedVersion:0}).expect(403);
  });
  it("a shared creator cannot edit, rename, delete, detach or publish; can copy privately", async () => {
    const own = await create("Creator original","only_me","excluded",user,{rules:[{competitor:"Ashirvad",scope:"everywhere"}]});
    const original = (await db.select().from(bucketListsTable).where(sql`id=${own.id}::uuid`))[0];
    await admin.post(`/api/bucket-lists/${own.id}/move-to-ho`).expect(200);
    const shared = (await user.get(`/api/bucket-lists/${own.id}`)).body;
    expect(shared.canEdit).toBe(false); expect(shared.visibility).toBe("everyone");
    for (const input of [{name:"Renamed"}, {rules:[]}, {visibility:"everyone"}, {visibility:"only_me"}])
      await user.patch(`/api/bucket-lists/${own.id}`).send(input).expect(403);
    await user.delete(`/api/bucket-lists/${own.id}`).expect(403);
    await user.post(`/api/bucket-lists/${own.id}/detach`).expect(403);
    const copy = await create("Creator copy","only_me","excluded",user,{parentId:own.id,addedCodes:[]});
    expect(copy.canEdit).toBe(true); expect(copy.visibility).toBe("only_me");
    for(const key of ["id","rules","addedCodes","removedCodes","createdBy","createdAt"])
      expect(shared[key]).toEqual(JSON.parse(JSON.stringify(original[key as keyof typeof original])));
    await otherAdmin.patch(`/api/bucket-lists/${own.id}`).send({name:"Admin renamed"}).expect(200);
    expect((await user.get(`/api/bucket-lists/${own.id}`)).body.ownerId).toBe("step6-user");
  });
  it("admin enforces a user's private list directly; creator edits return 403 after promotion", async () => {
    const own = await create("User enforced","only_me","excluded",user);
    const r = await enforce(own.id);
    expect(r.body.message).toBe('"User enforced" is in force, and is now an HO list so everyone can see what is being applied.');
    expect(r.body.enforced.list.id).toBe(own.id);
    expect(r.body.enforced.list.visibility).toBe("everyone");
    await user.patch(`/api/bucket-lists/${own.id}`).send({name:"Bad edit"}).expect(403);
    await user.delete(`/api/bucket-lists/${own.id}`).expect(403);
    const shared = (await admin.get(`/api/bucket-lists/${own.id}`)).body;
    expect(shared.updatedBy).toBe("Avery Admin");
  });
});
