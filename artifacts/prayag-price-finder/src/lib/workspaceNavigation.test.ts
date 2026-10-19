import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getWorkspaceLinks } from "../../../../lib/replit-auth-web/src/workspace-navigation.ts";

const source = (path: string) => readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
const consumers = [
  ["lib/replit-auth-web/src/workspace-header.tsx", "activeApp"],
  ["artifacts/prayag-price-finder/src/components/layout.tsx", '"price-finder"'],
  ["artifacts/prayag-product-db/src/components/layout.tsx", '"product-database"'],
  ["artifacts/prayag-analysis/src/components/AppShell.tsx", '"competition-analysis"'],
  ["artifacts/prayag-home/src/components/layout.tsx", '"home"'],
] as const;
const allApps = ["home", "product-database", "competition-analysis", "mrp-generator", "price-finder", "admin"];

for (const role of ["user", "counter"]) {
  test(`${role}: one ordered Price Finder link shared by header and every sidebar`, () => {
    assert.deepEqual(getWorkspaceLinks({ role }), [
      { app: "price-finder", href: "/price-finder/", label: "Price Finder" },
    ]);
  });
}

test("anonymous keeps protected non-admin destinations, with the header's original order", () => {
  assert.deepEqual(getWorkspaceLinks(null).map(l => [l.app, l.href]), [
    ["home", "/"], ["product-database", "/product-db/"],
    ["competition-analysis", "/analysis/"], ["price-finder", "/price-finder/"],
  ]);
  // This presentation fix must not replace the destination apps' sign-in gates.
  for (const app of ["prayag-home", "prayag-product-db", "prayag-analysis"]) {
    assert.match(source(`artifacts/${app}/src/App.tsx`), /if \(!isAuthenticated\) return <LoginForm \/>/);
  }
});

test("admin sees the complete ordered list, including Generator and Admin", () => {
  assert.deepEqual(getWorkspaceLinks({ role: "admin" }).map(l => l.app), allApps);
});

test("other resolved roles retain non-admin links; unresolved identity shows no links", () => {
  assert.deepEqual(getWorkspaceLinks({ role: "manager" }), getWorkspaceLinks(null));
  for (const user of [null, { role: "user" }, { role: "counter" }, { role: "admin" }]) {
    assert.deepEqual(getWorkspaceLinks(user, true), []);
  }
});

test("one visibility implementation: header and all four sidebar loops consume the shared hook without filtering", () => {
  const header = source(consumers[0][0]);
  assert.match(header, /return getWorkspaceLinks\(user, isLoading\)\.map/);
  assert.equal((header.match(/getWorkspaceLinks\(user, isLoading\)/g) ?? []).length, 1);
  for (const [path, activeApp] of consumers) {
    const text = source(path);
    assert.ok(text.includes(`useWorkspaceNavigation(${activeApp})`), path);
    assert.doesNotMatch(text, /APP_SWITCHER|WORKSPACE_LINKS|restrictedAllowed|isRestrictedAccount/, path);
    assert.doesNotMatch(text, /(?:appLinks|visibleLinks)\.filter/, path);
    assert.match(text, /(?:appLinks|visibleLinks)\.map/, path);
    // Inter-artifact destinations stay plain full-page links.
    assert.match(text, /<a[\s\S]*?href=\{(?:app|link)\.href\}/, path);
    assert.match(text, /aria-current=\{(?:app\.active|active) \? "page" : undefined\}/, path);
  }
  const index = source("lib/replit-auth-web/src/index.ts");
  assert.match(index, /export \{ getWorkspaceLinks \}/);
});

test("capacity counter is distinct from the unchanged Final Summary coverage disclosure", () => {
  const calculator = source("artifacts/prayag-price-finder/src/pages/calculator.tsx");
  assert.match(calculator, /\{blocks\.length\} products · \{MAX_CALCULATOR_BLOCKS\} max/);
  assert.doesNotMatch(calculator, /\{blocks\.length\} of \{MAX_CALCULATOR_BLOCKS\} products/);
  const summary = source("artifacts/prayag-price-finder/src/components/calculator/CalculatorSummary.tsx");
  assert.match(summary, /compared on[\s\S]*?\{b\.compared\} of \{b\.products\}<\/strong> products/);
  assert.match(summary, /of which[\s\S]*?hand-entered/);
});

test("mobile list labels and permission-dependent editor title are not Search products", () => {
  const layout = source("artifacts/prayag-price-finder/src/components/layout.tsx");
  const editor = source("artifacts/prayag-price-finder/src/pages/bucket-editor.tsx");
  assert.match(layout, /location === "\/bucket-lists" \? "Bucket lists"/);
  assert.match(layout, /mobilePageTitle \?\?/);
  assert.match(editor, /readOnly \? "View bucket list" : editId \? "Edit bucket list" : "New bucket list"/);
  assert.match(editor, /useMobilePageTitle\(pageTitle\)/);
  assert.match(editor, /\{pageTitle\}/);
});

test("Analysis matching workbench has its own breadcrumb", () => {
  assert.match(source("artifacts/prayag-analysis/src/components/AppShell.tsx"),
    /"\/mrp-generator\/matching": "Matching MRP Workbench"/);
});
