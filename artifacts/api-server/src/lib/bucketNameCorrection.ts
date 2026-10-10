import { eq } from "drizzle-orm";
import { db, bucketListsTable } from "@workspace/db";
import { loadBucketWorld, lockBuckets } from "./bucketLists";
import { enforcedAffected, enforcementSnapshot, recordEnforcedEdit } from "./bucketEnforcement";

// Approved metadata-only correction. This never creates a list, changes its
// definition/preferences, or puts anything in force. Publishing carries this
// exact existing-list rename to production; no production write during build.
export const plumbingListCorrection = {
  id: "91081464-2ef7-4659-9eef-ba548f63827c",
  before: "HO (Plumbing) — Excluded,",
  after: "HO (Plumbing) — Excluded",
};
export async function applyApprovedBucketNameCorrection() {
  return db.transaction(async tx => {
    await lockBuckets(tx);
    const world = await loadBucketWorld(tx);
    const list = world.byId.get(plumbingListCorrection.id);
    if (!list || list.name !== plumbingListCorrection.before || list.visibility !== "everyone")
      return { changed: 0 };
    const actor = { id: "system:approved-bucket-name-correction", admin: true, label: "Approved list-name correction" };
    const before = enforcedAffected(list.id, world) ? enforcementSnapshot(world.byId.get(world.enforcement!.listId!)!, world, actor) : null;
    const [saved] = await tx.update(bucketListsTable).set({
      name: plumbingListCorrection.after, updatedBy: actor.label, updatedAt: new Date(),
    }).where(eq(bucketListsTable.id, list.id)).returning();
    world.byId.set(saved.id, saved);
    if (before) await recordEnforcedEdit(tx, actor, world, before, saved.name);
    return { changed: 1, id: saved.id };
  });
}
