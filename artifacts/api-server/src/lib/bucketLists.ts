import { eq, sql } from "drizzle-orm";
import { PreviewBucketListBody } from "@workspace/api-zod";
import { db, bucketListsTable, bucketPreferencesTable, catalogProductsTable, type BucketListRecord } from "@workspace/db";
import { supportsCatalogRange } from "@workspace/formatting";
import { normalizeVocabularyKey } from "./priceEditorVocabulary";
import { BucketError, isLiveBucketProduct, matchesBucketRule, resolveBucketCodes, type BucketDefinition, type BucketProduct } from "./bucketMembership";

export type BucketActor = { id: string; admin: boolean; label: string };
export const bucketDraftSchema = PreviewBucketListBody.strict().superRefine((draft, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: "custom", message });
  if ((draft.name?.length ?? 0) > 180 || (draft.description?.length ?? 0) > 4000) invalid("Name or description is too long.");
  if (draft.parentId && !/^[0-9a-f-]{36}$/i.test(draft.parentId)) invalid("Invalid parent list ID.");
  if ((draft.rules?.length ?? 0) > 300) invalid("Use at most 300 rules.");
  for (const rule of draft.rules ?? []) {
    if (!(rule.division?.trim() || rule.category?.trim() || rule.range?.trim())) invalid("A rule must select something.");
    if ([rule.division, rule.category, rule.range].some(value => value !== undefined && (!value.trim() || value.length > 300))) invalid("Invalid rule selection.");
    if (rule.range && (!rule.division || !supportsCatalogRange(rule.division))) invalid("Range requires an approved Range division.");
  }
  for (const codes of [draft.addedCodes, draft.removedCodes]) {
    if ((codes?.length ?? 0) > 25000 || codes?.some(code => !code.trim() || code.length > 150)) invalid("Invalid item codes.");
  }
});
type Draft = typeof bucketDraftSchema["_output"];
type Executor = Pick<typeof db, "select" | "insert" | "update" | "delete" | "execute">;
export type BucketWorld = { catalogue: BucketProduct[]; lists: BucketListRecord[]; byId: Map<string, BucketListRecord> };

export async function loadBucketWorld(executor: Executor = db): Promise<BucketWorld> {
  const [catalogue, lists] = await Promise.all([
    executor.select({
      itemCode: catalogProductsTable.itemCode, productName: catalogProductsTable.productName,
      division: catalogProductsTable.division, category: catalogProductsTable.category,
      seriesRange: catalogProductsTable.seriesRange, isActive: catalogProductsTable.isActive,
      discontinuedFrom: catalogProductsTable.discontinuedFrom,
    }).from(catalogProductsTable), executor.select().from(bucketListsTable),
  ]);
  return { catalogue, lists, byId: new Map(lists.map(list => [list.id, list])) };
}
export function canReadBucket(list: BucketListRecord, actor: BucketActor) {
  return list.ownerId === actor.id || list.visibility === "everyone";
}
export function assertBucketVisible(id: string, actor: BucketActor, world: BucketWorld) {
  const list = world.byId.get(id);
  if (!list || !canReadBucket(list, actor)) throw new BucketError("Bucket list not found.", 404, "BUCKET_NOT_FOUND");
  return list;
}
function assertOwner(list: BucketListRecord, actor: BucketActor) {
  if (list.ownerId !== actor.id || (list.visibility === "everyone" && !actor.admin))
    throw new BucketError("You cannot change a bucket list you do not own.", 403, "BUCKET_FORBIDDEN");
}
function ownBucketCodes(definition: BucketDefinition, world: BucketWorld) {
  // Inherited archives belong to the original. Otherwise a child's old
  // observation could resurrect a code the parent explicitly removed.
  return resolveBucketCodes({ ...definition, parentId: null }, world.byId, world.catalogue);
}
export async function observeBucketMembership(list: BucketListRecord, world: BucketWorld, executor: Executor = db, visited = new Set<string>()) {
  if (visited.has(list.id)) throw new BucketError("A bucket list cannot inherit from itself.", 400, "BUCKET_CYCLE");
  visited.add(list.id);
  if (list.parentId) {
    const parent = world.byId.get(list.parentId);
    if (parent) await observeBucketMembership(parent, world, executor, visited);
  }
  const codes = [...ownBucketCodes(list, world)];
  const seen = new Set(list.observedCodes);
  if (!codes.some(code => !seen.has(code))) return;
  await executor.execute(sql`UPDATE bucket_lists SET observed_codes = (
    SELECT coalesce(jsonb_agg(code ORDER BY code), '[]'::jsonb)
    FROM (SELECT DISTINCT jsonb_array_elements_text(observed_codes || ${JSON.stringify(codes)}::jsonb) AS code) observed
  ) WHERE id = ${list.id}`);
  world.byId.set(list.id, { ...list, observedCodes: [...new Set([...list.observedCodes, ...codes])] });
}
export function describeBucket(definition: BucketDefinition & Partial<BucketListRecord>, world: BucketWorld, actor: BucketActor) {
  const codes = resolveBucketCodes(definition, world.byId, world.catalogue);
  const catalogue = new Map(world.catalogue.map(product => [product.itemCode, product]));
  const members = [...codes].sort().map(itemCode => {
    const product = catalogue.get(itemCode);
    return product ? { ...product, isActive: isLiveBucketProduct(product), missing: !isLiveBucketProduct(product) }
      : { itemCode, productName: null, division: null, category: null, seriesRange: null, isActive: false, discontinuedFrom: null, missing: true };
  });
  const divisionCounts = new Map<string, number>();
  for (const product of members) {
    const division = product.division ?? "No longer in catalogue";
    divisionCounts.set(division, (divisionCounts.get(division) ?? 0) + 1);
  }
  const parent = definition.parentId ? world.byId.get(definition.parentId) : null;
  return {
    ...definition, id: definition.id ?? "", name: definition.name ?? "", type: definition.type ?? "excluded",
    visibility: definition.visibility ?? "only_me", parentName: parent?.name ?? null,
    canEdit: definition.ownerId === actor.id && (definition.visibility !== "everyone" || actor.admin),
    count: members.length, activeCount: members.filter(p => p.isActive).length,
    missingCount: members.filter(p => p.missing).length, totalProducts: world.catalogue.length,
    members, divisions: [...divisionCounts].map(([division, count]) => ({ division, count })),
    ruleCounts: definition.rules.map(rule => ({ rule, count: world.catalogue.filter(p => matchesBucketRule(p, rule)).length })),
  };
}
export function prepareBucketDraft(input: unknown, actor: BucketActor, world: BucketWorld, previous?: BucketListRecord) {
  const result = bucketDraftSchema.safeParse(input);
  if (!result.success) throw new BucketError(result.error.issues.map(i => i.message).join("; "));
  const draft: Draft = result.data;
  const definition = {
    name: (draft.name ?? previous?.name ?? "").trim().replace(/\s+/g, " "),
    description: draft.description === undefined ? previous?.description ?? null : draft.description,
    type: draft.type ?? previous?.type ?? "excluded",
    visibility: draft.visibility ?? previous?.visibility ?? "only_me",
    parentId: draft.parentId === undefined ? previous?.parentId ?? null : draft.parentId,
    rules: draft.rules ?? previous?.rules ?? [],
    addedCodes: [...new Set((draft.addedCodes ?? previous?.addedCodes ?? []).map(code => code.trim()))],
    removedCodes: [...new Set((draft.removedCodes ?? previous?.removedCodes ?? []).map(code => code.trim()))],
    observedCodes: previous?.observedCodes ?? [],
    ...(previous ? { id: previous.id } : {}),
  };
  if (definition.visibility === "everyone" && !actor.admin)
    throw new BucketError("Admin access required to share a Head Office list.", 403, "BUCKET_FORBIDDEN");
  if (previous && definition.parentId !== previous.parentId)
    throw new BucketError("Use Detach from the original to freeze these members. To relink, start a new copy.");
  if (definition.parentId) {
    const parent = assertBucketVisible(definition.parentId, actor, world);
    if (definition.visibility === "everyone" && parent.visibility !== "everyone")
      throw new BucketError("Detach from a private original before sharing a Head Office list.");
    if (previous && parent.id === previous.id) throw new BucketError("A list cannot be its own original.");
  }
  return definition;
}
async function lockBuckets(executor: Executor) {
  await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtext('bucket-lists:membership'))`);
}
export async function saveBucket(input: unknown, actor: BucketActor, id?: string) {
  return db.transaction(async tx => {
    await lockBuckets(tx);
    const world = await loadBucketWorld(tx);
    const previous = id ? assertBucketVisible(id, actor, world) : undefined;
    if (previous) assertOwner(previous, actor);
    const draft = prepareBucketDraft(input, actor, world, previous);
    if (draft.parentId) await observeBucketMembership(world.byId.get(draft.parentId)!, world, tx);
    if (!draft.name || !normalizeVocabularyKey(draft.name)) throw new BucketError("A name is required.");
    const nameKey = normalizeVocabularyKey(draft.name);
    const conflict = world.lists.find(list => list.ownerId === actor.id && list.nameKey === nameKey && list.id !== id);
    if (conflict) throw new BucketError("You already have a list with this name.", 409, "BUCKET_NAME_EXISTS", { existingList: { id: conflict.id, name: conflict.name } });
    const codes = resolveBucketCodes(draft, world.byId, world.catalogue);
    const catalogueCodes = new Set(world.catalogue.map(p => p.itemCode));
    const oldCodes = previous ? resolveBucketCodes(previous, world.byId, world.catalogue) : new Set<string>();
    const inheritedCodes = draft.parentId ? resolveBucketCodes(world.byId.get(draft.parentId)!, world.byId, world.catalogue) : new Set<string>();
    const unknownAdded = draft.addedCodes.filter(code => !catalogueCodes.has(code) && !oldCodes.has(code) && !inheritedCodes.has(code));
    if (unknownAdded.length) throw new BucketError(`Codes not found in the catalogue: ${unknownAdded.join(", ")}`, 400, "BUCKET_CODES_NOT_FOUND");
    // A zero-match rule remains a valid definition: keep it and warn in the UI.
    if (!codes.size && !draft.rules.length && !draft.parentId) throw new BucketError("Add at least one item or rule.");
    if (previous?.visibility === "everyone" && draft.visibility === "only_me") {
      await freezeChildren(previous, world, tx, actor, child => child.ownerId !== actor.id || child.visibility === "everyone",
        "The original became private");
    }
    const values = {
      ...draft, nameKey, ownerId: actor.id, updatedBy: actor.label, updatedAt: new Date(),
      observedCodes: [...new Set([...draft.observedCodes, ...ownBucketCodes(draft, world)])],
    };
    const [saved] = previous
      ? await tx.update(bucketListsTable).set(values).where(eq(bucketListsTable.id, previous.id)).returning()
      : await tx.insert(bucketListsTable).values({ ...values, createdBy: actor.label }).returning();
    world.byId.set(saved.id, saved);
    return describeBucket(saved, world, actor);
  });
}
async function freezeChildren(parent: BucketListRecord, world: BucketWorld, executor: Executor, actor: BucketActor,
  predicate = (_child: BucketListRecord) => true, reason = "The original was deleted") {
  const children = world.lists.filter(child => child.parentId === parent.id && predicate(child));
  for (const child of children) {
    const codes = [...resolveBucketCodes(child, world.byId, world.catalogue)];
    const changed = {
      parentId: null, rules: [], addedCodes: codes, removedCodes: [], observedCodes: codes,
      detachedNotice: `${reason}: ${parent.name}. Your items were kept; this copy no longer updates automatically.`,
      updatedAt: new Date(), updatedBy: actor.label,
    };
    await executor.update(bucketListsTable).set(changed).where(eq(bucketListsTable.id, child.id));
    world.byId.set(child.id, { ...child, ...changed });
  }
  return children.length;
}
export async function deleteBucket(id: string, actor: BucketActor) {
  return db.transaction(async tx => {
    await lockBuckets(tx);
    const world = await loadBucketWorld(tx), list = assertBucketVisible(id, actor, world);
    assertOwner(list, actor);
    const detachedChildren = await freezeChildren(list, world, tx, actor);
    await tx.delete(bucketListsTable).where(eq(bucketListsTable.id, list.id));
    return { deleted: true, detachedChildren, message: "Only the bucket list was deleted. No products or prices were deleted." };
  });
}
/** Existing account deletion must not orphan linked copies or be blocked by
 * the new ownership/preference foreign keys. Called only after its admin guard. */
export async function deleteBucketDataForAccount(userId: string, label: string, executor: Executor) {
  await lockBuckets(executor);
  const world = await loadBucketWorld(executor);
  const owned = world.lists.filter(list => list.ownerId === userId);
  for (const list of owned) await freezeChildren(list, world, executor, { id: userId, admin: true, label },
    child => child.ownerId !== userId, "The original owner's account was deleted");
  await executor.delete(bucketPreferencesTable).where(eq(bucketPreferencesTable.userId, userId));
  for (const list of owned) await executor.delete(bucketListsTable).where(eq(bucketListsTable.id, list.id));
}
export async function detachBucket(id: string, actor: BucketActor) {
  return db.transaction(async tx => {
    await lockBuckets(tx);
    const world = await loadBucketWorld(tx), list = assertBucketVisible(id, actor, world);
    assertOwner(list, actor);
    const codes = [...resolveBucketCodes(list, world.byId, world.catalogue)];
    const [changed] = await tx.update(bucketListsTable).set({
      parentId: null, rules: [], addedCodes: codes, removedCodes: [], observedCodes: codes,
      detachedNotice: "Detached from the original. These fixed codes no longer update automatically. To relink, start again.",
      updatedAt: new Date(), updatedBy: actor.label,
    }).where(eq(bucketListsTable.id, id)).returning();
    return describeBucket(changed, world, actor);
  });
}
export async function getActiveBucket(actor: BucketActor) {
  const [preference] = await db.select().from(bucketPreferencesTable).where(eq(bucketPreferencesTable.userId, actor.id));
  if (!preference?.activeListId) return { list: null, banner: null, codes: [] as string[] };
  const world = await loadBucketWorld(), list = world.byId.get(preference.activeListId);
  if (!list || !canReadBucket(list, actor)) return { list: null, banner: null, codes: [] as string[] };
  await observeBucketMembership(list, world);
  const detail = describeBucket(list, world, actor), codes = detail.members.map(member => member.itemCode);
  const effect = list.type === "excluded" ? `${detail.activeCount} items hidden` : `${detail.activeCount} items shown`;
  return { list: detail, banner: `Showing: ${list.name} — ${list.type === "excluded" ? "Excluded" : "Included"} · ${effect}`, codes };
}
export async function setActiveBucket(actor: BucketActor, id: string | null) {
  // Serialize against deletion/visibility changes, so a stale selection cannot
  // bypass privacy or race a foreign-key failure.
  await db.transaction(async tx => {
    await lockBuckets(tx);
    if (id) assertBucketVisible(id, actor, await loadBucketWorld(tx));
    await tx.insert(bucketPreferencesTable).values({ userId: actor.id, activeListId: id }).onConflictDoUpdate({
      target: bucketPreferencesTable.userId, set: { activeListId: id, updatedAt: new Date() },
    });
  });
  return getActiveBucket(actor);
}