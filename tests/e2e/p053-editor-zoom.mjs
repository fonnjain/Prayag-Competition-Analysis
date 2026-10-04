import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

// Actual Chrome tab zoom, not CSS transforms or an emulated smaller viewport.
// Uses existing administrator credentials internally; never prints credentials.
const base = `https://${process.env.REPLIT_DEV_DOMAIN}`;
assert.ok(process.env.REPLIT_DEV_DOMAIN && new URL(base).hostname.endsWith(".replit.dev"));
const clock = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "medium" }).format(new Date());
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "p053-zoom-extension-"));
let context, sid;
try {
  await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify({
    manifest_version: 3, name: "Local zoom verification", version: "1.0",
    permissions: ["tabs"], background: { service_worker: "background.js" },
  }));
  await fs.writeFile(path.join(dir, "background.js"), "chrome.runtime.onInstalled.addListener(()=>{});");
  const login = await fetch(base + "/api/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
  });
  assert.equal(login.status, 200);
  sid = (await login.json()).sid;
  assert.ok(sid);
  const headers = { Authorization: `Bearer ${sid}` };
  assert.equal((await (await fetch(base + "/api/auth/user", { headers })).json()).user?.role, "admin");
  const catalogue = await (await fetch(base + "/api/bucket-lists/catalogue", { headers })).json();
  const codes = [...new Set(catalogue.products.map(p => p.itemCode))].slice(0, 184);
  assert.equal(codes.length, 184);
  context = await chromium.launchPersistentContext("", {
    channel: "chromium", headless: true, viewport: { width: 1366, height: 768 },
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
  });
  await context.route("**/api/activity/**", route => route.abort());
  await context.addInitScript(token => localStorage.setItem("prayag_sid", token), sid);
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(base + "/price-finder/");
  const zoom = await worker.evaluate(async () => {
    const tab = (await chrome.tabs.query({})).find(t => t.url?.includes("/price-finder/"));
    await chrome.tabs.setZoom(tab.id, 1.25);
    return await chrome.tabs.getZoom(tab.id);
  });
  assert.equal(zoom, 1.25);
  const manifest = JSON.parse(await fs.readFile("reports/p053-step2/screenshot-manifest.json", "utf8"));
  const narrowOnly = process.env.P053_STEP2_NARROW_ONLY === "1";
  if (narrowOnly) {
    await worker.evaluate(async () => {
      const tab = (await chrome.tabs.query({})).find(t => t.url?.includes("/price-finder/"));
      await chrome.tabs.setZoom(tab.id, 1);
    });
    await page.setViewportSize({ width: 480, height: 850 });
  }
  for (const count of narrowOnly ? [0, 1] : [0, 1, 184]) {
    const params = new URLSearchParams();
    for (const code of codes.slice(0, count)) params.append("code", code);
    await page.goto(base + "/price-finder/bucket-lists/edit?" + params);
    await page.getByTestId("input-bucket-name").fill(`Unsaved zoom check ${crypto.randomUUID()}`);
    await expect(page.getByTestId("text-item-count")).toContainText(`${count} item`);
    await expect(page.getByTestId("text-live-effect")).toContainText(`${count} hidden`);
    if (narrowOnly) await page.getByTestId("panel-summary").scrollIntoViewIfNeeded();
    const save = page.getByTestId("button-save-bucket");
    if (count === 0) await expect(save).toBeDisabled(); else await expect(save).toBeEnabled();
    await expect(save).toBeInViewport();
    await page.getByTestId("region-summary-scroll").evaluate(el => { el.scrollTop = el.scrollHeight; });
    const geometry = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
    assert.equal(geometry.dpr, narrowOnly ? 1 : 1.25);
    const box = await save.boundingBox();
    assert.ok(box.y >= 0 && box.y + box.height <= geometry.height);
    const filename = `editor-${narrowOnly ? "narrow" : "actual-125pct"}-${count}.png`, timeIST = clock();
    await page.screenshot({ path: "reports/p053-step2/" + filename });
    manifest.push({ filename, environment: "development preview", timeIST, viewport: geometry, zoom: narrowOnly ? 1 : zoom, dataCount: count });
    console.log(JSON.stringify({ timeIST, environment: "development", count, zoom: narrowOnly ? 1 : zoom, geometry, saveVisible: true, filename }));
  }
  await fs.writeFile("reports/p053-step2/screenshot-manifest.json", JSON.stringify(manifest, null, 2));
} finally {
  await context?.close();
  await fs.rm(dir, { recursive: true, force: true });
  if (sid) {
    const headers = { Authorization: `Bearer ${sid}` };
    await fetch(base + "/api/logout", { headers });
    assert.equal((await (await fetch(base + "/api/auth/user", { headers })).json()).user, null);
    console.log("Own development check session revoked", clock(), "IST");
  }
}