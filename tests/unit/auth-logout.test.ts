import { test } from "node:test";
import assert from "node:assert/strict";
import { revokeBrowserSession } from "../../lib/replit-auth-web/src/logout.ts";

test("bearer-only logout transmits the retained session and includes cookies", async () => {
  let received: RequestInit | undefined;
  await revokeBrowserSession((async (url, options) => {
    assert.equal(url, "/api/logout");
    received = options;
    return { ok: true } as Response;
  }) as typeof fetch, "not-a-real-session");
  assert.deepEqual(received?.headers, { Authorization: "Bearer not-a-real-session" });
  assert.equal(received?.credentials, "include");
});
test("cookie-only logout remains supported", async () => {
  await revokeBrowserSession((async (_url, options) => {
    assert.deepEqual(options?.headers, {});
    return { ok: true } as Response;
  }) as typeof fetch, null);
});
test("failed server revocation is explicit", async () => {
  await assert.rejects(revokeBrowserSession((async () => ({ ok: false } as Response)) as typeof fetch, "not-a-real-session"), /could not be confirmed/);
});