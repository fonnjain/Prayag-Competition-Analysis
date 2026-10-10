import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { resolvePersonalSelection, updatePersonalSelection } from "./bucketSelection";

beforeAll(async () => {
  expect((await db.execute(sql`SELECT current_schema() AS schema`)).rows[0].schema).toMatch(/^p051_suite_/);
});

const make = (id: string, type: "included" | "excluded", ownerId = "me", visibility: "only_me" | "everyone" = "only_me") =>
  ({ id, name: id, type, ownerId, visibility });
const lists = new Map([
  make("inc1", "included"), make("inc2", "included"), make("ex1", "excluded"), make("ex2", "excluded"),
  make("company", "excluded", "ho", "everyone"), make("private", "excluded", "other"),
].map(list => [list.id, list]));
const read = (activeListId: string | null = null, excludedListIds: string[] = []) =>
  resolvePersonalSelection({ activeListId, excludedListIds }, lists, "me", "company");

describe("P053 Step 5 personal selection", () => {
  it("reads legacy Excluded and Included IDs without rewriting preferences", () => {
    expect(read("ex1").excluded.map(l => l.id)).toEqual(["ex1"]);
    expect(read("inc1").included?.id).toBe("inc1");
  });
  it("adds exclusions without clearing Included or earlier exclusions", () => {
    const next = updatePersonalSelection(read("inc1", ["ex1"]), lists.get("ex2")!);
    expect(next).toMatchObject({ activeListId: "inc1", excludedListIds: ["ex1", "ex2"] });
  });
  it("Excluded order and duplicates do not matter", () => {
    expect(read("inc1", ["ex2", "ex1", "ex1"])).toEqual(read("inc1", ["ex1", "ex2"]));
  });
  it("replaces just the Included list and says so", () => {
    expect(updatePersonalSelection(read("inc1", ["ex1", "ex2"]), lists.get("inc2")!)).toEqual({
      activeListId: "inc2", excludedListIds: ["ex1", "ex2"], message: "Included list “inc1” replaced by “inc2”.",
    });
  });
  it("removes one exclusion without clearing the others", () => {
    expect(updatePersonalSelection(read("inc1", ["ex1", "ex2"]), lists.get("ex1")!, false))
      .toMatchObject({ activeListId: "inc1", excludedListIds: ["ex2"] });
  });
  it("removes Included without clearing exclusions", () => {
    expect(updatePersonalSelection(read("inc1", ["ex1", "ex2"]), lists.get("inc1")!, false))
      .toMatchObject({ activeListId: null, excludedListIds: ["ex1", "ex2"] });
  });
  it("never treats enforcement, private or deleted lists as personal selections", () => {
    expect(read("company", ["company", "private", "deleted", "ex1"]).personalLists.map(l => l.id)).toEqual(["ex1"]);
  });
  it("does not activate a second Included from a changed Excluded definition", () => {
    expect(read("inc1", ["inc2", "ex1"]).personalLists.map(l => l.id)).toEqual(["inc1", "ex1"]);
  });
  it("clear-all affects only the personal preference", () => {
    expect(updatePersonalSelection(read("inc1", ["ex1", "ex2"]), null))
      .toMatchObject({ activeListId: null, excludedListIds: [] });
  });
});
