import { test } from "node:test";
import assert from "node:assert/strict";
import { BUCKET_TYPE, bucketEffectShort, groupBucketChoices } from "../../lib/api-client-react/src/bucketType.ts";

test("type groups put HO first without editing names or source order", () => {
  const lists = [
    { id: "mine-x", name: "Excluded", type: "excluded", visibility: "only_me" },
    { id: "mine-i", name: "A personal list", type: "included", visibility: "only_me" },
    { id: "ho-x", name: "HO (Plumbing) — Excluded", type: "excluded", visibility: "everyone" },
    { id: "ho-i", name: "Z Head Office", type: "included", visibility: "everyone" },
  ];
  const before = JSON.stringify(lists);
  const groups = groupBucketChoices(lists);
  assert.deepEqual(Object.keys(groups), ["included", "excluded"]);
  assert.deepEqual(groups.included.map(x => x.id), ["ho-i", "mine-i"]);
  assert.deepEqual(groups.excluded.map(x => x.id), ["ho-x", "mine-x"]);
  assert.equal(groups.excluded[0].name, "HO (Plumbing) — Excluded");
  assert.equal(groups.excluded[1].name, "Excluded");
  assert.equal(JSON.stringify(lists), before);
});
test("short effect is separate from name and type, including zero", () => {
  assert.equal(bucketEffectShort("excluded", 184), "184 hidden");
  assert.equal(bucketEffectShort("included", 42), "only 42 shown");
  assert.equal(bucketEffectShort("included", 0), "only 0 shown");
  assert.equal(bucketEffectShort("excluded", 1), "1 hidden");
});
test("one distinct colour palette and heading per type", () => {
  assert.notEqual(BUCKET_TYPE.included.dot, BUCKET_TYPE.excluded.dot);
  assert.notEqual(BUCKET_TYPE.included.bg, BUCKET_TYPE.excluded.bg);
  assert.equal(BUCKET_TYPE.included.heading, "SHOW ONLY THESE");
  assert.equal(BUCKET_TYPE.excluded.heading, "HIDE THESE");
});