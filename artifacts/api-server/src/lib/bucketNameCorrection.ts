import { eq } from "drizzle-orm";
import { db, bucketListsTable, usersTable } from "@workspace/db";
import { lockBuckets } from "./bucketLists";

export const plumbingListCorrection = {
  id: "91081464-2ef7-4659-9eef-ba548f63827c",
  before: "HO (Plumbing) — Excluded,",
  after: "HO (Plumbing) — Excluded",
};

// Repair only the previously approved rename's actor metadata on publish.
// Never rename another row, invent an actor, alter the original timestamp,
// modify definitions/preferences, or enforce/release anything.
export async function applyApprovedBucketNameCorrection() {
  return db.transaction(async tx => {
    await lockBuckets(tx);
    const [list] = await tx.select().from(bucketListsTable).where(eq(bucketListsTable.id, plumbingListCorrection.id));
    if (!list || list.name !== plumbingListCorrection.after || list.updatedBy !== "Approved list-name correction")
      return { changed: 0 };
    const [owner] = await tx.select({
      firstName: usersTable.firstName, lastName: usersTable.lastName, role: usersTable.role,
    }).from(usersTable).where(eq(usersTable.id, list.ownerId!));
    const person = [owner?.firstName, owner?.lastName].filter(Boolean).join(" ").trim();
    // The approved row's unchanged owner and creation attribution identify
    // the signed-in admin. Refuse to guess if that evidence no longer agrees.
    if (owner?.role !== "admin" || !person || person !== list.createdBy)
      throw new Error("The approved list audit repair requires verified administrator attribution.");
    await tx.update(bucketListsTable).set({updatedBy: person}).where(eq(bucketListsTable.id, list.id));
    return { changed: 1, id: list.id };
  });
}
