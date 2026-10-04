import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const XLSX = createRequire(path.resolve("artifacts/api-server/package.json"))("xlsx");

test.use({ trace: "off" });
test("P053 Step 2 development global bucket control/editor acceptance", async ({ page, request, baseURL }) => {
  test.setTimeout(180000);
  const host = new URL(baseURL!).hostname;
  expect(["localhost", "127.0.0.1", process.env.REPLIT_DEV_DOMAIN].includes(host)).toBeTruthy();
  test.skip(!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD, "Existing development administrator credentials required.");
  await page.route("**/api/activity/**", route => route.abort());
  const dir = path.resolve("reports/p053-step2");
  fs.mkdirSync(dir, { recursive: true });
  const editOnly = process.env.P053_STEP2_EDIT_ONLY === "1";
  const remaining = process.env.P053_STEP2_REMAINING === "1" || editOnly;
  const stamp = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "medium", hour12: false }).format(new Date());
  const manifest: any[] = remaining && fs.existsSync(path.join(dir, "screenshot-manifest.json")) ? JSON.parse(fs.readFileSync(path.join(dir, "screenshot-manifest.json"), "utf8")) : [];
  const snap = async (name: string, count: number | null = null) => {
    const filename = `${name}.png`;
    const atIST = stamp();
    await page.screenshot({ path: path.join(dir, filename), fullPage: true });
    manifest.push({ filename, environment: "development preview", timeIST: atIST, viewport: page.viewportSize(), dataCount: count });
    console.log(`SCREENSHOT ${filename} IST ${atIST} viewport=${JSON.stringify(page.viewportSize())} dataCount=${count}`);
  };
  const login = await request.post("/api/login", { data: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } });
  expect(login.ok()).toBeTruthy();
  const { sid } = await login.json();
  const headers = { Authorization: `Bearer ${sid}` };
  expect((await (await request.get("/api/auth/user", { headers })).json()).user?.role).toBe("admin");
  const priorActive = await (await request.get("/api/bucket-lists/active", { headers })).json();
  const original = priorActive;
  let excludedId: string | undefined, includedId: string | undefined;
  try {
    const catRes = await request.get("/api/bucket-lists/catalogue", { headers });
    expect(catRes.ok()).toBeTruthy();
    const products = (await catRes.json()).products as { itemCode: string }[];
    const codes = Array.from(new Set(products.map(p => p.itemCode).filter(Boolean)));
    expect(codes.length).toBeGreaterThanOrEqual(184);
    const make = async (name: string, type: string, addedCodes: string[]) => {
      const response = await request.post("/api/bucket-lists", { headers, data: { name, type, visibility: "only_me", rules: [], addedCodes, removedCodes: [] } });
      expect(response.status()).toBe(201);
      return (await response.json()).id as string;
    };
    excludedId = await make("HO (Plumbing) — Excluded", "excluded", codes.slice(0, 184));
    includedId = await make("Excluded", "included", codes.slice(0, 1));
    for (const id of [excludedId, includedId]) {
      const detail = await (await request.get(`/api/bucket-lists/${id}`, { headers })).json();
      expect(detail.visibility).toBe("only_me");
    }
    await page.addInitScript(token => localStorage.setItem("prayag_sid", token), sid);
    await page.setViewportSize({ width: 1366, height: 768 });
    if (!remaining) {
    expect((await request.put("/api/bucket-lists/active", { headers, data: { listId: null } })).ok()).toBeTruthy();
    await page.goto("/price-finder/");
    const control = page.getByTestId("bucket-control");
    await expect(control).toHaveAttribute("data-state", "none");
    await expect(page.getByTestId("button-bucket-open")).toContainText("Bucket:");
    await expect(page.locator('[data-testid="bucket-banner"]')).toHaveCount(0);
    await snap("control-inactive");
    await page.getByTestId("button-bucket-open").click();
    const menu = page.getByTestId("menu-bucket");
    await expect(menu.getByTestId("option-bucket-none")).toBeVisible();
    await expect(menu.getByTestId("group-bucket-included")).toBeVisible();
    await expect(menu.getByTestId("group-bucket-excluded")).toBeVisible();
    await expect(menu.getByTestId("link-choose-bucket")).toBeVisible();
    await expect(menu.getByTestId(`option-bucket-${includedId}`)).toContainText("Excluded");
    await expect(menu.getByTestId(`option-bucket-${excludedId}`)).toContainText("HO (Plumbing) — Excluded");
    await expect(menu.getByTestId(`option-bucket-${excludedId}`)).toContainText("184 products");
    await snap("control-dropdown-groups");
    await menu.getByTestId(`option-bucket-${excludedId}`).click();
    await expect(control).toHaveAttribute("data-state", "active");
    await expect(page.getByTestId("text-bucket-name")).toHaveText("HO (Plumbing) — Excluded");
    await expect(page.getByTestId("text-bucket-type")).toHaveText("Excluded");
    await expect(page.getByTestId("text-bucket-effect")).toHaveText("184 hidden");
    await snap("control-active-excluded", 184);
    await page.getByTestId("button-bucket-open").click();
    await page.getByTestId(`option-bucket-${includedId}`).click();
    await expect(page.getByTestId("text-bucket-name")).toHaveText("Excluded");
    await expect(page.getByTestId("text-bucket-type")).toHaveText("Included");
    await expect(page.getByTestId("text-bucket-effect")).toHaveText("only 1 shown");
    await snap("control-active-included", 1);
    await page.getByTestId("button-bucket-clear").click();
    await expect(control).toHaveAttribute("data-state", "none");
    expect((await (await request.get("/api/bucket-lists/active", { headers })).json()).list).toBeNull();

    await page.goto("/price-finder/bucket-lists");
    for (const id of [excludedId, includedId]) await expect(page.getByTestId(`row-bucket-${id}`)).toBeVisible();
    await page.getByTestId("chip-ho").click();
    await page.getByTestId("chip-type-included").click();
    await expect(page.getByTestId("chip-ho")).toHaveClass(/bg-primary/);
    await expect(page.getByTestId("chip-type-included")).toHaveClass(/border-sky-600/);
    await expect(page.getByTestId(`row-bucket-${excludedId}`)).toHaveCount(0);
    await expect(page.getByTestId(`row-bucket-${includedId}`)).toHaveCount(0);
    await page.getByTestId("chip-mine").click();
    await expect(page.getByTestId("chip-type-included")).toHaveClass(/border-sky-600/);
    await expect(page.getByTestId(`row-bucket-${includedId}`)).toBeVisible();
    }

    await (await request.put("/api/bucket-lists/active", { headers, data: { listId: excludedId } })).dispose();
    if (!editOnly) {
    const routes = [
      "/product-db/", `/product-db/product?itemCode=${encodeURIComponent(codes[0])}`, "/product-db/comparison",
      "/product-db/mapping-review", "/price-finder/", "/price-finder/comparison", "/analysis/",
      "/analysis/mrp-generator", "/analysis/mrp-generator/matching", "/analysis/mrp-generator/runs/nonexistent-id",
      "/analysis/mrp-generator/compare",
    ];
    for (const route of remaining ? routes.slice(8) : routes) {
      await page.goto(route);
      console.log("ROUTE acceptance:", route, "IST", stamp());
      await expect(page.getByTestId("bucket-control")).toHaveAttribute("data-state", "active", { timeout: 15000 });
      await expect(page.getByTestId("text-bucket-name")).toHaveText("HO (Plumbing) — Excluded");
    }
    await page.goto("/analysis/mrp-generator");
    await page.getByRole("button", { name: /New Scenario/i }).click();
    await expect(page.getByRole("dialog").getByTestId("bucket-control")).toHaveAttribute("data-state", "active");
    await page.keyboard.press("Escape");
    await page.goto("/product-db/load-mrp");
    await expect(page.getByTestId("bucket-control")).toHaveCount(0);
    await expect(page.getByText(/Bucket lists do not apply here|full[- ]scope/i).first()).toBeVisible();

    const active = await (await request.get("/api/bucket-lists/active", { headers })).json();
    const exportRes = await request.get("/api/catalog/export?scope=in-force&type=catalog&format=csv&asOf=2026-10-04", { headers });
    expect(exportRes.ok()).toBeTruthy();
    const bytes = await exportRes.body();
    fs.writeFileSync(path.join(dir, "development-filtered-catalogue.csv"), bytes);
    const csv = bytes.toString("utf8");
    const workbook = XLSX.read(bytes, { type: "buffer", codepage: 65001 });
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "" }) as string[][];
    expect(rows[0][0]).toBe(active.banner);
    expect(rows[1][0]).toBe("Display-only product filter; no source product or price data changed.");
    console.log(`EXPORT development-filtered-catalogue.csv IST ${stamp()} firstLine=${JSON.stringify(csv.split(/\r?\n/)[0])} secondLine=${JSON.stringify(csv.split(/\r?\n/)[1])} bytes=${bytes.length}`);

    const editor = async (count: number, width: number, height: number, label: string) => {
      await page.setViewportSize({ width, height });
      const params = new URLSearchParams();
      for (const c of codes.slice(0, count)) params.append("code", c);
      await page.goto(`/price-finder/bucket-lists/edit?${params.toString()}`);
      await page.getByTestId("input-bucket-name").fill(`Layout verification ${crypto.randomUUID()}`);
      await expect(page.getByTestId("panel-summary")).toBeVisible();
      await expect(page.getByTestId("text-item-count")).toContainText(`${count} item`);
      if (width < 1024) await page.getByTestId("panel-summary").scrollIntoViewIfNeeded();
      const save = page.getByTestId("button-save-bucket");
      await expect(save).toBeVisible();
      await expect(save).toBeInViewport();
      if (count === 0) await expect(save).toBeDisabled(); else await expect(save).toBeEnabled();
      const footer = await save.boundingBox();
      expect(footer && footer.y + footer.height).toBeLessThanOrEqual(height + 1);
      await page.getByTestId("region-summary-scroll").evaluate(el => { el.scrollTop = el.scrollHeight; });
      const afterScroll = await save.boundingBox();
      expect(afterScroll && afterScroll.y + afterScroll.height).toBeLessThanOrEqual(height + 1);
      await snap(`editor-${label}-${count}`, count);
    };
    for (const n of [0, 1, 184]) await editor(n, 1366, 768, "1366x768");
    for (const n of [0, 1, 184]) await editor(n, 1093, 614, "125pct-css-equivalent");
    await editor(184, 480, 850, "narrow");
    }
    for (const viewport of [{ width: 1366, height: 768 }, { width: 1093, height: 614 }, { width: 480, height: 850 }]) {
      await page.setViewportSize(viewport);
      await page.goto(`/price-finder/bucket-lists/edit?id=${excludedId}`);
      await expect(page.getByTestId("text-item-count")).toContainText("184 items");
      if (viewport.width < 1024) await page.getByTestId("panel-summary").scrollIntoViewIfNeeded();
      await expect(page.getByTestId("button-save-bucket")).toBeInViewport();
      await page.getByTestId("region-summary-scroll").evaluate(el => { el.scrollTop = el.scrollHeight; });
      await expect(page.getByTestId("button-save-bucket")).toBeInViewport();
      console.log(`EDIT 184 items viewport=${JSON.stringify(viewport)} IST ${stamp()} passed`);
    }
    await fs.promises.writeFile(path.join(dir, "screenshot-manifest.json"), JSON.stringify(manifest, null, 2));
  } finally {
    const restored = await request.put("/api/bucket-lists/active", { headers, data: { listId: original.list?.id ?? null } }).catch(() => null);
    const deletedIncluded = includedId ? await request.delete(`/api/bucket-lists/${includedId}`, { headers }).catch(() => null) : null;
    const deletedExcluded = excludedId ? await request.delete(`/api/bucket-lists/${excludedId}`, { headers }).catch(() => null) : null;
    const logout = await request.get("/api/logout", { headers }).catch(() => null as any);
    console.log("CLEANUP active restore/delete included/delete excluded/logout statuses", restored?.status?.(), deletedIncluded?.status?.(), deletedExcluded?.status?.(), logout?.status?.());
    await fs.promises.writeFile(path.join(dir, "screenshot-manifest.json"), JSON.stringify(manifest, null, 2)).catch(() => undefined);
    await page.context().clearCookies();
  }
});