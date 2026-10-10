import { eq, sql } from "drizzle-orm";
import { PreviewBucketListBody } from "@workspace/api-zod";
import { db, bucketListsTable, bucketPreferencesTable, catalogProductsTable, competitorPricesTable, bucketEnforcementTable, usersTable, type BucketEnforcementRecord, type BucketListRecord } from "@workspace/db";
import { supportsCatalogRange } from "@workspace/formatting";
import { normalizeVocabularyKey } from "./priceEditorVocabulary";
import { BucketError, bucketAllowsCode, isLiveBucketProduct, matchesBucketRule, resolveBucketCodes, type BucketDefinition, type BucketProduct } from "./bucketMembership";
import { normCode } from "./catalog";
import { compileCompetitorRules, competitorImpact, competitorOptions, hasProductDefinition, resolveCompetitorRules, type CompetitorQuote } from "./bucketCompetitors";
import { assertEnforcedDelete, assertEnforcedEdit, assertEnforcementAdmin, enforcedAffected, enforcementSnapshot, recordEnforcedEdit } from "./bucketEnforcement";
import { composedProductAllowed, composedQuoteAllowed, composedDisclosure, type BucketLayer } from "./bucketComposition";
import { resolvePersonalSelection, updatePersonalSelection } from "./bucketSelection";

export type BucketActor = { id: string; admin: boolean; label: string };
export const bucketDraftSchema = PreviewBucketListBody.strict().superRefine((draft, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: "custom", message });
  if ((draft.name?.length ?? 0) > 180 || (draft.description?.length ?? 0) > 4000) invalid("Name or description is too long.");
  if (draft.parentId && !/^[0-9a-f-]{36}$/i.test(draft.parentId)) invalid("Invalid parent list ID.");
  if ((draft.rules?.length ?? 0) > 300) invalid("Use at most 300 rules.");
  for (const rule of draft.rules ?? []) {
    if (rule.competitor) {
      if (rule.division || rule.category || rule.range) invalid("A competitor rule cannot also be a product rule.");
      if (!rule.scope) invalid("Choose a competitor scope.");
      const values = rule.scope === "division" ? rule.divisions : rule.scope === "category" ? rule.categories : [];
      if (rule.scope !== "everywhere" && !values?.length) invalid("Choose at least one division or category.");
      if ((values?.length ?? 0) > 300 || values?.some(value => !value.trim() || value.length > 300)) invalid("Invalid competitor scope.");
      continue;
    }
    if (rule.scope || rule.divisions || rule.categories) invalid("Choose a stored competitor for the scope.");
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
export type BucketExecutor = Executor;
export type BucketWorld = { catalogue: BucketProduct[]; lists: BucketListRecord[]; byId: Map<string, BucketListRecord>;
  ownerNames?: Map<string, string>;
  competitorNames?: string[]; quotes?: CompetitorQuote[]; enforcement?: BucketEnforcementRecord };

export async function loadBucketWorld(executor: Executor = db): Promise<BucketWorld> {
  const [catalogue, lists, names, currentQuotes, enforcement, owners] = await Promise.all([
    executor.select({
      itemCode: catalogProductsTable.itemCode, productName: catalogProductsTable.productName,
      division: catalogProductsTable.division, category: catalogProductsTable.category,
      seriesRange: catalogProductsTable.seriesRange, isActive: catalogProductsTable.isActive,
      discontinuedFrom: catalogProductsTable.discontinuedFrom,
    }).from(catalogProductsTable), executor.select().from(bucketListsTable),
    // Price-row text is the only brand authority. No freehand picker spelling.
    executor.select({ competitor: competitorPricesTable.competitor }).from(competitorPricesTable).groupBy(competitorPricesTable.competitor),
    executor.execute<{ id: number; competitor: string; matchedPrayagCode: string; price: number }>(sql`
      SELECT DISTINCT ON (competitor, matched_prayag_code)
        id, competitor, matched_prayag_code AS "matchedPrayagCode", price
      FROM competitor_prices WHERE matched_prayag_code IS NOT NULL AND match_status = 'matched'
        AND effective_date <= CURRENT_DATE AND price IS NOT NULL
      ORDER BY competitor, matched_prayag_code, effective_date DESC, id DESC`),
    executor.select().from(bucketEnforcementTable).where(eq(bucketEnforcementTable.id, 1)),
    executor.select({id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName}).from(usersTable),
  ]);
  return { catalogue, lists, byId: new Map(lists.map(list => [list.id, list])),
    ownerNames: new Map(owners.map(user => [user.id, [user.firstName,user.lastName].filter(Boolean).join(" ").trim() || user.id])),
    competitorNames: names.map(row => row.competitor).sort(), quotes: currentQuotes.rows, enforcement: enforcement[0] };
}
export function canReadBucket(list: BucketListRecord, actor: BucketActor) {
  return actor.admin || list.ownerId === actor.id || list.creatorId === actor.id || list.visibility === "everyone";
}
export function bucketInOwnerTab(list: BucketListRecord, actor: BucketActor, owner: "all" | "ho" | "mine") {
  if (!canReadBucket(list, actor)) return false;
  const ho = list.visibility === "everyone";
  const mine = list.ownerId === actor.id && list.visibility === "only_me";
  return owner === "ho" ? ho : owner === "mine" ? mine : true;
}
export function assertBucketVisible(id: string, actor: BucketActor, world: BucketWorld) {
  const list = world.byId.get(id);
  if (!list || !canReadBucket(list, actor)) throw new BucketError("Bucket list not found.", 404, "BUCKET_NOT_FOUND");
  return list;
}
function assertOwner(list: BucketListRecord, actor: BucketActor) {
  if (!actor.admin && list.ownerId !== actor.id && list.creatorId !== actor.id)
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
  const competitorRules = resolveCompetitorRules(definition, world.byId);
  const productFilterApplied = !competitorRules.length || hasProductDefinition(definition, world.byId);
  const normalizedCodes = new Set([...codes].map(normCode));
  const type = definition.type ?? "excluded";
  const impact = competitorImpact(type, competitorRules, world.catalogue, world.quotes ?? [],
    code => !productFilterApplied || bucketAllowsCode(type, normalizedCodes, code));
  return {
    ...definition, id: definition.id ?? "", name: definition.name ?? "", type: definition.type ?? "excluded",
    visibility: definition.visibility ?? "only_me", parentName: parent && canReadBucket(parent, actor) ? parent.name : null,
    ownerName: world.ownerNames?.get(definition.ownerId ?? "") ??
      (definition.ownerId === actor.id ? actor.label : (definition as BucketListRecord).createdBy ?? definition.ownerId ?? ""),
    canEdit: actor.admin || definition.ownerId === actor.id || (definition as BucketListRecord).creatorId === actor.id,
    isEnforced: !!definition.id && definition.id === world.enforcement?.listId,
    affectsEnforced: !!definition.id && enforcedAffected(definition.id, world),
    enforcedListName: world.enforcement?.listId ? world.byId.get(world.enforcement.listId)?.name ?? null : null,
    count: members.length, activeCount: members.filter(p => p.isActive).length,
    missingCount: members.filter(p => p.missing).length, totalProducts: world.catalogue.length,
    members, divisions: [...divisionCounts].map(([division, count]) => ({ division, count })),
    ruleCounts: definition.rules.filter(rule => !rule.competitor).map(rule => ({ rule, count: world.catalogue.filter(p => matchesBucketRule(p, rule)).length })),
    competitorRules, competitorCount: new Set(competitorRules.map(rule => rule.competitor)).size,
    productFilterApplied, ...impact,
  };
}
export function prepareBucketDraft(input: unknown, actor: BucketActor, world: BucketWorld, previous?: BucketListRecord) {
  const result = bucketDraftSchema.safeParse(input);
  if (!result.success) throw new BucketError(result.error.issues.map(i => i.message).join("; "));
  const draft: Draft = result.data;
  const options = competitorOptions(world.competitorNames ?? [], world.catalogue, world.quotes ?? []);
  for (const rule of draft.rules ?? []) {
    if (!rule.competitor) continue;
    const option = options.find(value => value.competitor === rule.competitor);
    if (!option) throw new BucketError("Choose a competitor from the stored list.");
    if (rule.scope === "division" && rule.divisions?.some(value => !option.divisions.some(d => d.value === value)))
      throw new BucketError("That competitor has no current prices in the selected division.");
    if (rule.scope === "category" && rule.categories?.some(value => !option.categories.some(c => normalizeVocabularyKey(c.value) === normalizeVocabularyKey(value))))
      throw new BucketError("That competitor has no current prices in the selected category.");
  }
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
  if (previous && definition.visibility !== previous.visibility && !actor.admin)
    throw new BucketError("Only administrators can move existing lists.", 403, "BUCKET_FORBIDDEN");
  if (previous && definition.parentId !== previous.parentId)
    throw new BucketError("Use Detach from the original to freeze these members. To relink, start a new copy.");
  if (definition.parentId) {
    const parent = previous?.parentId === definition.parentId && previous.ownerId === actor.id
      ? world.byId.get(definition.parentId) : assertBucketVisible(definition.parentId, actor, world);
    if (!parent) throw new BucketError("Original list not found.", 404, "BUCKET_NOT_FOUND");
    if (definition.visibility === "everyone" && parent.visibility !== "everyone" && previous?.visibility !== "everyone")
      throw new BucketError("Detach from a private original before sharing a Head Office list.");
    if (previous && parent.id === previous.id) throw new BucketError("A list cannot be its own original.");
  }
  return definition;
}
export async function lockBuckets(executor: Executor) {
  await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtext('bucket-lists:membership'))`);
}
export async function saveBucket(input: unknown, actor: BucketActor, id?: string) {
  return db.transaction(async tx => {
    await lockBuckets(tx);
    const world = await loadBucketWorld(tx);
    const previous = id ? assertBucketVisible(id, actor, world) : undefined;
    if (previous) assertOwner(previous, actor);
    const affects = previous ? assertEnforcedEdit(previous.id, input, actor, world) : false;
    const before = affects ? enforcementSnapshot(world.byId.get(world.enforcement!.listId!)!, world, actor) : null;
    const draft = prepareBucketDraft(input, actor, world, previous);
    if (previous && previous.id === world.enforcement?.listId && draft.visibility !== "everyone")
      throw new BucketError("A list in force must remain Everyone. Take it out of force before making it private.");
    if (draft.parentId) await observeBucketMembership(world.byId.get(draft.parentId)!, world, tx);
    if (!draft.name || !normalizeVocabularyKey(draft.name)) throw new BucketError("A name is required.");
    const nameKey = normalizeVocabularyKey(draft.name);
    const ownerId = previous?.ownerId ?? actor.id;
    const conflict = world.lists.find(list => list.ownerId === ownerId && list.nameKey === nameKey && list.id !== id);
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
      await retainActiveSelections(tx, previous.id);
      await freezeChildren(previous, world, tx, actor, child => child.ownerId !== actor.id || child.visibility === "everyone",
        "The original became private");
    }
    const values = {
      ...draft, nameKey, ownerId, updatedBy: actor.label, updatedAt: new Date(),
      observedCodes: [...new Set([...draft.observedCodes, ...ownBucketCodes(draft, world)])],
    };
    const [saved] = previous
      ? await tx.update(bucketListsTable).set(values).where(eq(bucketListsTable.id, previous.id)).returning()
      : await tx.insert(bucketListsTable).values({ ...values, creatorId: actor.id, createdBy: actor.label }).returning();
    world.byId.set(saved.id, saved);
    if (before) await recordEnforcedEdit(tx, actor, world, before, saved.name);
    return describeBucket(saved, world, actor);
  });
}
async function retainActiveSelections(tx: Executor, id: string) {
  // Server-owned grants cover only preferences already switched on under Everyone.
  // They never make the now-private list readable or selectable by another user.
  await tx.execute(sql`UPDATE bucket_preferences SET retained_active_list_ids =
    CASE WHEN retained_active_list_ids ? ${id} THEN retained_active_list_ids
      ELSE retained_active_list_ids || ${JSON.stringify([id])}::jsonb END
    WHERE active_list_id = ${id}::uuid OR excluded_list_ids ? ${id}`);
}
export async function moveBucketInside(tx: Executor, actor: BucketActor, world: BucketWorld,
  id: string, visibility: "everyone" | "only_me") {
  assertEnforcementAdmin(actor);
  const list = assertBucketVisible(id, actor, world);
  if (visibility === "only_me" && enforcedAffected(id, world))
    throw new BucketError("This list or its original is in force. Take it out of force before moving it to My lists.", 409, "ENFORCED_MOVE_FORBIDDEN");
  const ownerId = visibility === "only_me" ? actor.id : list.ownerId;
  if (world.lists.some(other => other.id !== id && other.ownerId === ownerId && other.nameKey === list.nameKey))
    throw new BucketError("You already have a list with this name. Rename one before moving.", 409, "BUCKET_NAME_EXISTS");
  if (list.visibility === "everyone" && visibility === "only_me") {
    await retainActiveSelections(tx, id);
    await freezeChildren(list, world, tx, actor, child => child.ownerId !== actor.id || child.visibility === "everyone", "The original became private");
  }
  const [saved] = await tx.update(bucketListsTable).set({
    visibility, ownerId, updatedBy: actor.label, updatedAt: new Date(),
  }).where(eq(bucketListsTable.id, id)).returning();
  world.byId.set(saved.id, saved);
  return saved;
}
export async function moveBucket(id: string, visibility: "everyone" | "only_me", actor: BucketActor) {
  assertEnforcementAdmin(actor);
  return db.transaction(async tx => {
    await lockBuckets(tx);
    const world = await loadBucketWorld(tx);
    const saved = await moveBucketInside(tx, actor, world, id, visibility);
    return { list: describeBucket(saved, world, actor),
      message: visibility === "everyone"
        ? `"${saved.name}" is now an HO list, visible to everyone.`
        : `"${saved.name}" is now in My lists, visible only to you.` };
  });
}
function frozenCompetitorRules(definition: Parameters<typeof resolveCompetitorRules>[0], world: BucketWorld, codes: string[]) {
  return resolveCompetitorRules(definition, world.byId).map((rule, index) =>
    !codes.length && index === 0 && hasProductDefinition(definition, world.byId)
      ? { ...rule, retainProductFilter: true } : rule);
}
async function freezeChildren(parent: BucketListRecord, world: BucketWorld, executor: Executor, actor: BucketActor,
  predicate = (_child: BucketListRecord) => true, reason = "The original was deleted") {
  const children = world.lists.filter(child => child.parentId === parent.id && predicate(child));
  for (const child of children) {
    const codes = [...resolveBucketCodes(child, world.byId, world.catalogue)];
    const changed = {
      parentId: null, rules: frozenCompetitorRules(child, world, codes), addedCodes: codes, removedCodes: [], observedCodes: codes,
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
    assertEnforcedDelete(id, world);
    const detachedChildren = await freezeChildren(list, world, tx, actor);
    await tx.execute(sql`UPDATE bucket_preferences SET excluded_list_ids = excluded_list_ids - ${list.id},
      retained_active_list_ids = retained_active_list_ids - ${list.id}
      WHERE excluded_list_ids ? ${list.id} OR retained_active_list_ids ? ${list.id}`);
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
  for (const list of owned) assertEnforcedDelete(list.id, world);
  for (const list of owned) await freezeChildren(list, world, executor, { id: userId, admin: true, label },
    child => child.ownerId !== userId, "The original owner's account was deleted");
  await executor.delete(bucketPreferencesTable).where(eq(bucketPreferencesTable.userId, userId));
  for (const list of owned) {
    await executor.execute(sql`UPDATE bucket_preferences SET excluded_list_ids = excluded_list_ids - ${list.id}
      WHERE excluded_list_ids ? ${list.id}`);
    await executor.delete(bucketListsTable).where(eq(bucketListsTable.id, list.id));
  }
}
export async function detachBucket(id: string, actor: BucketActor, input: unknown = {}) {
  return db.transaction(async tx => {
    await lockBuckets(tx);
    const world = await loadBucketWorld(tx), list = assertBucketVisible(id, actor, world);
    assertOwner(list, actor);
    const affects = assertEnforcedEdit(id, input, actor, world);
    const before = affects ? enforcementSnapshot(world.byId.get(world.enforcement!.listId!)!, world, actor) : null;
    const codes = [...resolveBucketCodes(list, world.byId, world.catalogue)];
    const [changed] = await tx.update(bucketListsTable).set({
      parentId: null, rules: frozenCompetitorRules(list, world, codes), addedCodes: codes, removedCodes: [], observedCodes: codes,
      detachedNotice: "Detached from the original. These fixed codes no longer update automatically. To relink, start again.",
      updatedAt: new Date(), updatedBy: actor.label,
    }).where(eq(bucketListsTable.id, id)).returning();
    world.byId.set(changed.id, changed);
    if (before) await recordEnforcedEdit(tx, actor, world, before, changed.name);
    return describeBucket(changed, world, actor);
  });
}
export async function getActiveBucket(actor: BucketActor | null, forFilter = false) {
  const [state] = await db.select().from(bucketEnforcementTable).where(eq(bucketEnforcementTable.id, 1));
  const [preference] = actor ? await db.select().from(bucketPreferencesTable).where(eq(bucketPreferencesTable.userId, actor.id)) : [];
  if (!state?.listId && !preference?.activeListId && !preference?.excludedListIds.length)
    return { list: null, included: null, excluded: [], personalLists: [], enforced: null, banner: null, codes: [] as string[], layers: [] as BucketLayer[],
      enforcementVersion: state?.version ?? 0, noCompetitorPriceCount: 0 };
  const world = await loadBucketWorld();
  const viewer = actor ?? { id: "", admin: false, label: "" };
  const forced = world.enforcement?.listId ? world.byId.get(world.enforcement.listId) : null;
  if (world.enforcement?.listId && (!forced || forced.visibility !== "everyone"))
    throw new BucketError("Invalid company enforcement; refusing an unfiltered fallback.", 500, "ENFORCEMENT_INVALID");
  const selection = resolvePersonalSelection(preference, world.byId, viewer.id, forced?.id ?? null, viewer.admin);
  const enforced = forced ? describeBucket(forced, world, viewer) : null;
  for (const personal of selection.personalLists) await observeBucketMembership(world.byId.get(personal.id)!, world);
  const personalLists = selection.personalLists.map(list => describeBucket(world.byId.get(list.id)!, world, viewer));
  const included = personalLists.find(list => list.type === "included") ?? null;
  const excluded = personalLists.filter(list => list.type === "excluded");
  // Company is independent of user selection, always first and never clearable.
  const details = [...(enforced ? [enforced] : []), ...personalLists];
  const layers: BucketLayer[] = details.map(value => ({
    type: value.type, codes: new Set(value.members.map(member => normCode(member.itemCode))),
    productFilterApplied: value.productFilterApplied, clauses: compileCompetitorRules(value.competitorRules, world.catalogue),
  }));
  const impact = competitorImpact("excluded", [], world.catalogue, world.quotes ?? [],
    code => composedProductAllowed(layers, code), (brand, code) => composedQuoteAllowed(layers, brand, code));
  const banner = details.length ? composedDisclosure(enforced, personalLists) : null;
  return { list: included ?? excluded[0] ?? null, included, excluded, personalLists, enforced, banner,
    codes: [...new Set(personalLists.flatMap(list => list.members.map(member => member.itemCode)))],
    layers: forFilter ? layers : [], clauses: forFilter ? layers.at(-1)?.clauses : undefined,
    enforcementVersion: world.enforcement?.version ?? 0, ...impact };
}
export async function setActiveBucket(actor: BucketActor, id: string | null, active = true) {
  // Serialize against deletion/visibility changes, so a stale selection cannot
  // bypass privacy or race a foreign-key failure.
  const message = await db.transaction(async tx => {
    await lockBuckets(tx);
    const world = await loadBucketWorld(tx);
    if (id && id === world.enforcement?.listId)
      throw new BucketError("The enforced list applies automatically and cannot be selected or cleared here.", 403, "BUCKET_ENFORCED");
    const [preference] = await tx.select().from(bucketPreferencesTable).where(eq(bucketPreferencesTable.userId, actor.id));
    const current = resolvePersonalSelection(preference, world.byId, actor.id, world.enforcement?.listId ?? null, actor.admin);
    // The owner tabs/private-detail endpoint remain strict. A former shared-list
    // user may only turn OFF an already-retained filter, never select it anew.
    const target = id ? (!active && current.personalLists.some(list => list.id === id)
      ? world.byId.get(id)! : assertBucketVisible(id, actor, world)) : null;
    const { message, ...next } = updatePersonalSelection(current, target, active);
    const retainedActiveListIds = (preference?.retainedActiveListIds ?? [])
      .filter(listId => next.activeListId === listId || next.excludedListIds.includes(listId));
    await tx.insert(bucketPreferencesTable).values({ userId: actor.id, ...next, retainedActiveListIds }).onConflictDoUpdate({
      target: bucketPreferencesTable.userId, set: { ...next, retainedActiveListIds, updatedAt: new Date() },
    });
    return message;
  });
  return { ...await getActiveBucket(actor), ...(message ? { message } : {}) };
}