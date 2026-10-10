import { desc, eq } from "drizzle-orm";
import { db, bucketEnforcementTable, bucketEnforcementHistoryTable, type BucketListRecord } from "@workspace/db";
import { EnforceBucketListBody, ReleaseBucketEnforcementBody } from "@workspace/api-zod";
import { BucketError, resolveBucketCodes } from "./bucketMembership";
import { describeBucket, loadBucketWorld, lockBuckets, type BucketActor, type BucketWorld, type BucketExecutor } from "./bucketLists";
import { compileCompetitorRules } from "./bucketCompetitors";

export function enforcedAffected(id: string, world: BucketWorld): boolean {
  const seen = new Set<string>();
  let current = world.enforcement?.listId ?? null;
  while (current && !seen.has(current)) {
    if (current === id) return true;
    seen.add(current); current = world.byId.get(current)?.parentId ?? null;
  }
  return false;
}
export function assertEnforcementAdmin(actor: BucketActor) {
  if (!actor.admin) throw new BucketError("Only a Head Office administrator can change company enforcement.", 403, "ENFORCEMENT_FORBIDDEN");
}
export function assertEnforcedEdit(id: string, _input: unknown, actor: BucketActor, world: BucketWorld) {
  if (!enforcedAffected(id, world)) return false;
  assertEnforcementAdmin(actor);
  return true;
}
export function assertEnforcedDelete(id: string, world: BucketWorld) {
  if (enforcedAffected(id, world))
    throw new BucketError(`"${world.byId.get(world.enforcement!.listId!)?.name}" is in force. Take it out of force before deleting this list or its original.`, 409, "ENFORCED_DELETE_FORBIDDEN");
}
export function enforcementSnapshot(list: BucketListRecord, world: BucketWorld, actor: BucketActor) {
  const detail = describeBucket(list, world, actor);
  return {
    id: list.id, name: list.name, type: list.type, visibility: list.visibility,
    definition: { rules: list.rules, addedCodes: list.addedCodes, removedCodes: list.removedCodes, parentId: list.parentId },
    resolvedProductCodes: [...resolveBucketCodes(list, world.byId, world.catalogue)].sort(),
    resolvedCompetitorRules: detail.competitorRules,
    compiledCompetitorScopes: compileCompetitorRules(detail.competitorRules, world.catalogue)
      .map(c => ({ competitor: c.competitor, codes: c.codes === null ? null : [...c.codes].sort() })),
    productFilterApplied: detail.productFilterApplied,
    itemCount: detail.activeCount, competitorCount: detail.competitorCount,
    competitorPriceCount: detail.competitorPriceCount, noCompetitorPriceCount: detail.noCompetitorPriceCount,
  };
}
export async function recordEnforcedEdit(tx: BucketExecutor, actor: BucketActor, world: BucketWorld,
  before: Record<string, unknown>, editedName: string) {
  const state = world.enforcement!;
  const list = world.byId.get(state.listId!)!;
  const snapshot = enforcementSnapshot(list, world, actor);
  const version = state.version + 1;
  await tx.update(bucketEnforcementTable).set({ version, updatedAt: new Date() }).where(eq(bucketEnforcementTable.id, 1));
  await tx.insert(bucketEnforcementHistoryTable).values({
    version, action: "edited", actorId: actor.id, actorLabel: actor.label,
    // Retain the legacy storage column without prompting for a reason.
    reason: "",
    listId: list.id, listName: list.name, listType: list.type,
    itemCount: snapshot.itemCount, competitorCount: snapshot.competitorCount, competitorPriceCount: snapshot.competitorPriceCount,
    beforeSnapshot: before, snapshot,
  });
  world.enforcement = { ...state, version };
}
export async function getBucketEnforcement(actor: BucketActor) {
  const world = await loadBucketWorld();
  const state = world.enforcement;
  const list = state?.listId ? world.byId.get(state.listId) : null;
  if (state?.listId && (!list || list.visibility !== "everyone"))
    throw new BucketError("Invalid company enforcement definition; refusing an unfiltered fallback.", 500, "ENFORCEMENT_INVALID");
  const events = await db.select().from(bucketEnforcementHistoryTable)
    .orderBy(desc(bucketEnforcementHistoryTable.version), desc(bucketEnforcementHistoryTable.occurredAt));
  const history = events.map(({ reason: _legacyReason, ...event }) => event);
  return { version: state?.version ?? 0,
    enforced: list ? { list: describeBucket(list, world, actor), actorLabel: state!.actorLabel ?? "",
      enforcedAt: state!.enforcedAt?.toISOString() ?? state!.updatedAt.toISOString() } : null,
    history };
}
export async function changeBucketEnforcement(input: unknown, actor: BucketActor, release = false) {
  assertEnforcementAdmin(actor);
  const parsed = (release ? ReleaseBucketEnforcementBody : EnforceBucketListBody).safeParse(input);
  if (!parsed.success) throw new BucketError("Choose a Head Office list; refresh if company enforcement changed.");
  const body = parsed.data;
  await db.transaction(async tx => {
    await lockBuckets(tx);
    const world = await loadBucketWorld(tx), state = world.enforcement;
    if (body.expectedVersion !== (state?.version ?? 0))
      throw new BucketError("Company enforcement changed. Refresh and try again.", 409, "ENFORCEMENT_STALE");
    const previous = state?.listId ? world.byId.get(state.listId) : null;
    const id = !release ? EnforceBucketListBody.parse(input).listId : null;
    const next = !release && id ? world.byId.get(id) : null;
    if (!release && !next) throw new BucketError("Head Office list not found.", 404, "BUCKET_NOT_FOUND");
    if (next && next.visibility !== "everyone") throw new BucketError("A private list cannot be enforced. Choose an Everyone (Head Office) list.");
    if (release && !previous) throw new BucketError("No list is in force.");
    const list = (release ? previous : next)!;
    const snapshot = enforcementSnapshot(list, world, actor);
    const version = (state?.version ?? 0) + 1, now = new Date();
    const values = { listId: release ? null : list.id, version, actorId: actor.id, actorLabel: actor.label,
      reason: null, enforcedAt: release ? null : now, updatedAt: now };
    await tx.insert(bucketEnforcementTable).values({ id: 1, ...values }).onConflictDoUpdate({ target: bucketEnforcementTable.id, set: values });
    await tx.insert(bucketEnforcementHistoryTable).values({
      version, action: release ? "released" : previous ? "replaced" : "enforced",
      actorId: actor.id, actorLabel: actor.label, reason: "", listId: list.id, listName: list.name, listType: list.type,
      itemCount: snapshot.itemCount, competitorCount: snapshot.competitorCount, competitorPriceCount: snapshot.competitorPriceCount,
      previousListName: previous?.name ?? null, beforeSnapshot: previous ? enforcementSnapshot(previous, world, actor) : null, snapshot,
    });
  });
  return getBucketEnforcement(actor);
}
