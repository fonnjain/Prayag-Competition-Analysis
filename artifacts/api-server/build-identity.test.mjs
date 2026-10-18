import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIdentity } from "./build-identity.mjs";

test("captures source identity at build time", () => {
  const calls = [];
  const git = (args) => {
    calls.push(args);
    return args.at(-1) === "HEAD" && args.includes("--abbrev-ref") ? "main" : "a".repeat(40);
  };
  const identity = buildIdentity("/unused", {}, git);
  assert.equal(identity.commitSha, "a".repeat(40));
  assert.equal(identity.branch, "main");
  assert.ok(Number.isFinite(Date.parse(identity.builtAt)));
  assert.equal(calls.length, 2);
});

test("explicit build inputs work without Git metadata", () => {
  const identity = buildIdentity("/unused", {
    BUILD_COMMIT_SHA: "b".repeat(40), BUILD_BRANCH: "release",
  }, () => { throw new Error("Git is unavailable"); });
  assert.equal(identity.commitSha, "b".repeat(40));
  assert.equal(identity.branch, "release");
});

test("missing or invalid source identity fails the build, never guesses", () => {
  assert.throws(() => buildIdentity("/unused", { BUILD_COMMIT_SHA: "c".repeat(40) }), /together/);
  assert.throws(() => buildIdentity("/unused", {}, () => { throw new Error("no Git"); }));
  assert.throws(() => buildIdentity("/unused", {
    BUILD_COMMIT_SHA: "unknown", BUILD_BRANCH: "main",
  }), /full commit SHA/);
});
