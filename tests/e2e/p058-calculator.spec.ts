import { expect, test, type Page } from "@playwright/test";

const AS_OF = "2026-10-16";

async function blockIdAt(page: Page, index: number): Promise<string> {
  const testId = await page.locator('[data-testid^="block-"]').nth(index).getAttribute("data-testid");
  expect(testId).toBeTruthy();
  return testId!.slice("block-".length);
}

async function chooseSearchProduct(page: Page, id: string, code: string) {
  await page.getByTestId(`select-product-${id}`).click();
  await page.getByTestId(`select-product-${id}-search`).fill(code);
  await page.getByTestId(`select-product-${id}-option-${code}`).click();
}

async function chooseVariant(page: Page, id: string, variant: string) {
  await page.getByTestId(`select-variant-${id}`).click();
  await page.getByTestId(`select-variant-${id}-option-${variant}`).click();
}

async function addCompetitor(page: Page, id: string, brand: string): Promise<string> {
  await page.getByTestId(`button-add-competitor-${id}`).click();
  const rowTestId = await page.getByTestId(`block-${id}`)
    .locator('[data-testid^="row-competitor-"]').getAttribute("data-testid");
  expect(rowTestId).toBeTruthy();
  const competitorId = rowTestId!.slice("row-competitor-".length);
  await page.getByTestId(`select-competitor-${competitorId}`).click();
  await page.getByTestId(`select-competitor-${competitorId}-option-${brand}`).click();
  return competitorId;
}

test("p058 anonymous three-product price calculator journey", async ({ page, browser, request, baseURL }) => {
  test.skip(
    !baseURL || !new URL(baseURL).hostname.endsWith(".replit.dev"),
    "Run only against the actual development preview; do not target production.",
  );

  const defaultsRequests: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/price-finder/discount-defaults")) defaultsRequests.push(req.url());
  });

  // Read-only API evidence: all chosen codes and actual competitor coverage.
  const rowsResponse = await request.get(
    `/api/price-finder/calculator/rows?code=5162&code=5163&code=4663&asOf=${AS_OF}`,
  );
  expect(rowsResponse.status()).toBe(200);
  const evidence = await rowsResponse.json();
  expect(evidence.asOfDate).toBe(AS_OF);
  expect(evidence.rows.map((row: { itemCode: string }) => row.itemCode).sort()).toEqual(["4663", "5162", "5163"]);
  const ivory = evidence.rows.find((row: { itemCode: string }) => row.itemCode === "4663");
  expect(ivory.variants.find((v: { variant: string }) => v.variant === "Ivory").price).toBe(2620);

  await page.goto("/price-finder/calculator");
  await expect(page.getByTestId("input-calculator-asof")).toHaveValue(AS_OF);
  const firstId = await blockIdAt(page, 0);
  await expect(page.getByTestId(`select-product-${firstId}`)).toBeFocused();
  await expect(page.getByTestId("button-final-summary")).toBeDisabled();

  // 5162 + Prince.
  await chooseSearchProduct(page, firstId, "5162");
  await page.getByTestId(`input-discount-${firstId}`).fill("20");
  await page.getByTestId(`input-quantity-${firstId}`).fill("7");
  const princeId = await addCompetitor(page, firstId, "Prince");
  await page.getByTestId(`input-competitor-discount-${princeId}`).fill("18");
  await expect(page.getByTestId(`text-our-total-${firstId}`)).toHaveText("₹155.68");
  await expect(page.getByTestId(`text-competitor-total-${princeId}`)).toHaveText("₹166.46");

  // Exercise Division → category → product using actual 4663 options, then
  // switch to direct search for actual 5163.
  await page.getByTestId("button-add-product").click();
  const secondId = await blockIdAt(page, 1);
  await page.getByTestId(`tab-picker-browse-${secondId}`).click();
  await page.getByTestId(`select-division-${secondId}`).click();
  await page.getByTestId(`select-division-${secondId}-search`).fill("Ceramic Sanitaryware");
  await page.getByTestId(`select-division-${secondId}-option-Ceramic Sanitaryware`).click();
  await page.getByTestId(`select-category-${secondId}`).click();
  await page.getByTestId(`select-category-${secondId}-search`).fill("Eve");
  await page.getByTestId(`select-category-${secondId}-option-Eve`).click();
  await page.getByTestId(`select-browse-product-${secondId}`).click();
  await page.getByTestId(`select-browse-product-${secondId}-option-4663`).click();
  await chooseVariant(page, secondId, "Ivory");
  await expect(page.getByTestId(`text-our-total-${secondId}`)).toHaveText("₹2,620.00");
  await expect(page.getByTestId(`text-no-competitors-${secondId}`)).toContainText("No competitor prices recorded");
  await page.getByTestId(`tab-picker-direct-${secondId}`).click();
  await chooseSearchProduct(page, secondId, "5163");
  await page.getByTestId(`input-discount-${secondId}`).fill("33.33");
  await page.getByTestId(`input-quantity-${secondId}`).fill("2");
  const apolloId = await addCompetitor(page, secondId, "Apollo");
  await page.getByTestId(`input-competitor-discount-${apolloId}`).fill("18");
  await expect(page.getByTestId(`text-our-total-${secondId}`)).toHaveText("₹271.08");
  await expect(page.getByTestId(`text-competitor-total-${apolloId}`)).toHaveText("₹270.60");

  // Third product: actual 4663 Ivory, with no competitor price.
  await page.getByTestId("button-add-product").click();
  const thirdId = await blockIdAt(page, 2);
  await chooseSearchProduct(page, thirdId, "4663");
  await chooseVariant(page, thirdId, "Ivory");
  await page.getByTestId(`input-discount-${thirdId}`).fill("20");
  await page.getByTestId(`input-quantity-${thirdId}`).fill("3");
  await expect(page.getByTestId(`text-our-total-${thirdId}`)).toHaveText("₹6,288.00");
  await expect(page.getByTestId(`text-no-competitors-${thirdId}`)).toContainText("No competitor prices recorded");

  await page.getByTestId("button-final-summary").click();
  await expect(page.getByTestId("table-summary-products").locator("tbody tr")).toHaveCount(3);
  await expect(page.getByTestId("text-summary-products")).toHaveText("3");
  await expect(page.getByTestId("text-summary-quantity")).toHaveText("12");
  await expect(page.getByTestId("text-summary-our-value")).toHaveText("₹6,714.76");
  await expect(page.getByTestId("row-brand-total-Prince")).toContainText("compared on 1 of 3 products");
  await expect(page.getByTestId("row-brand-total-Apollo")).toContainText("compared on 1 of 3 products");
  await expect(page.getByTestId("list-disclosures")).toContainText("1 products in this set have no competitor selected");
  await expect(page.getByTestId("list-disclosures")).toContainText("1 products have no competitor price recorded");
  await expect(page.getByTestId("list-disclosures")).toContainText("Bucket lists: none applied");
  expect(defaultsRequests).toEqual([]);

  // Keyboard dismissal and Arrow/Enter selection on an actual result.
  const productPicker = page.getByTestId(`select-product-${thirdId}`);
  await productPicker.click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId(`select-product-${thirdId}-search`)).toHaveCount(0);
  await productPicker.click();
  await page.getByTestId(`select-product-${thirdId}-search`).fill("4663");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(productPicker).toContainText("4663");
  await expect(page.getByTestId(`select-variant-${thirdId}`)).toContainText("Ivory");

  // The wide comparison table scrolls within its region; the document does not.
  await page.setViewportSize({ width: 360, height: 800 });
  const mobile = await page.evaluate(() => {
    const region = document.querySelector('[aria-label="Per-product comparison"]') as HTMLElement | null;
    return {
      viewport: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      tableRegionWidth: region?.clientWidth ?? 0,
      tableRegionScrollWidth: region?.scrollWidth ?? 0,
    };
  });
  expect(mobile.documentWidth).toBeLessThanOrEqual(mobile.viewport);
  expect(mobile.tableRegionScrollWidth).toBeGreaterThan(mobile.tableRegionWidth);

  // Restore desktop and leave the final summary open.
  await page.setViewportSize({ width: 1366, height: 768 });
  await expect(page.getByTestId("panel-final-summary")).toBeVisible();
  await expect(page.getByTestId("text-summary-our-value")).toHaveText("₹6,714.76");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("button-export-calculator").click(),
  ]);
  await download.saveAs("generated-artifacts/p058/calculator-three-products.xlsx");

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByTestId("button-copy-link").click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  const copyContext = await browser.newContext({ baseURL, timezoneId: "UTC" });
  try {
    const copyPage = await copyContext.newPage();
    await copyPage.goto(link);
    await expect(copyPage.getByTestId("input-calculator-asof")).toHaveValue(AS_OF);
    await expect(copyPage.getByTestId("input-discount-" + firstId)).toHaveValue("20");
    await expect(copyPage.getByTestId("input-quantity-" + firstId)).toHaveValue("7");
    await expect(copyPage.getByTestId("input-discount-" + secondId)).toHaveValue("33.33");
    await expect(copyPage.getByTestId("input-quantity-" + secondId)).toHaveValue("2");
    await expect(copyPage.getByTestId("input-discount-" + thirdId)).toHaveValue("20");
    await expect(copyPage.getByTestId("input-quantity-" + thirdId)).toHaveValue("3");
    await expect(copyPage.getByTestId(`select-competitor-${princeId}`)).toContainText("Prince");
    await expect(copyPage.getByTestId(`select-competitor-${apolloId}`)).toContainText("Apollo");
    await expect(copyPage.getByTestId(`text-our-total-${thirdId}`)).toHaveText("₹6,288.00");
  } finally {
    await copyContext.close();
  }
});
