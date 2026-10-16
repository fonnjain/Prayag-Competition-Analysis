import { test, expect } from "@playwright/test";

test.use({ trace: "off" }); // Real session handoff must never appear in a trace.
test("saved filter scopes the first browse render after a full reload; bearer logout revokes it", async ({ page, request, baseURL }) => {
  const host = new URL(baseURL!).hostname;
  expect(["localhost", "127.0.0.1", process.env.REPLIT_DEV_DOMAIN].includes(host)).toBeTruthy();
  test.skip(!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD, "Existing development administrator credentials required.");
  await page.route("**/api/activity/**", route => route.abort());
  const login = await request.post("/api/login", { data: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } });
  expect(login.ok()).toBeTruthy();
  const { sid } = await login.json();
  const headers = { Authorization: `Bearer ${sid}` };
  let id: string | undefined;
  const original = await (await request.get("/api/bucket-lists/active", { headers })).json();
  try {
    const created = await request.post("/api/bucket-lists", { headers, data: {
      name: `Reload acceptance ${crypto.randomUUID()}`, type: "included", visibility: "only_me", rules: [], addedCodes: ["F-70"], removedCodes: [],
    } });
    expect(created.status()).toBe(201);
    id = (await created.json()).id;
    expect((await request.put("/api/bucket-lists/active", { headers, data: { listId: id } })).ok()).toBeTruthy();
    const expected = await (await request.get("/api/price-finder/browse?limit=300", { headers })).json();
    const expectedCounts = expected.divisions.map((d: { division: string; count: number }) => ({ division: d.division, count: d.count }));
    expect(expectedCounts.reduce((sum: number, d: { count: number }) => sum + d.count, 0)).toBe(1);
    await page.context().clearCookies(); // Exercise the real bearer-only path.
    await page.addInitScript(token => {
      localStorage.setItem("prayag_sid", token);
      const state = window as unknown as { firstDivisionTotals?: { division: string | null; count: number }[] };
      // Division picker is a searchable combobox: options mount only when open.
      // Record the first option set ever rendered after reload so a stale/unscoped
      // flash would still be caught.
      new MutationObserver(() => {
        const nodes = document.querySelectorAll('[data-testid^="select-browse-division-option-"]');
        if (nodes.length && !state.firstDivisionTotals) state.firstDivisionTotals = Array.from(nodes, node => ({
          division: node.getAttribute("data-value"), count: Number(node.getAttribute("data-count")),
        }));
      }).observe(document, { subtree: true, childList: true });
    }, sid);
    await page.goto("/price-finder/");
    await page.getByTestId("select-browse-division").click();
    await expect(page.locator('[data-testid^="select-browse-division-option-"]')).toHaveCount(expectedCounts.length);
    await page.keyboard.press("Escape");
    const requests: boolean[] = [];
    page.on("request", r => {
      if (new URL(r.url()).pathname === "/api/price-finder/browse") requests.push(Boolean(r.headers().authorization));
    });
    await page.reload();
    // Trigger stays disabled until scoped divisions load; open as soon as it is usable.
    await expect(page.getByTestId("select-browse-division")).toBeEnabled();
    await page.getByTestId("select-browse-division").click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { firstDivisionTotals?: unknown }).firstDivisionTotals)).toEqual(expectedCounts);
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every(Boolean)).toBeTruthy();
    // Restore/remove only this transient filter before exercising user logout.
    expect((await request.put("/api/bucket-lists/active", { headers, data: { listId: original.list?.id ?? null } })).ok()).toBeTruthy();
    expect((await request.delete(`/api/bucket-lists/${id}`, { headers })).ok()).toBeTruthy();
    id = undefined;
    await page.getByRole("button", { name: /log out/i }).first().click();
    await expect.poll(async () => (await (await request.get("/api/auth/user", { headers })).json()).user).toBeNull();
  } finally {
    if (id) {
      await request.put("/api/bucket-lists/active", { headers, data: { listId: original.list?.id ?? null } });
      await request.delete(`/api/bucket-lists/${id}`, { headers });
    }
    await request.get("/api/logout", { headers });
    expect((await (await request.get("/api/auth/user", { headers })).json()).user).toBeNull();
    await page.context().clearCookies();
  }
});