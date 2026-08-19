import { expect, type Page, test } from "@playwright/test";

type AppId = "home" | "product-db" | "analysis" | "price-finder";

type App = {
  id: AppId;
  label: string;
  path: string;
  links: readonly AppId[];
};

const apps: readonly App[] = [
  {
    id: "home",
    label: "Home",
    path: "/",
    links: ["home", "product-db", "analysis", "price-finder"],
  },
  {
    id: "product-db",
    label: "Product Database",
    path: "/product-db/",
    links: ["home", "analysis", "price-finder"],
  },
  {
    id: "analysis",
    label: "Competition Analysis",
    path: "/analysis/",
    links: ["home", "product-db", "price-finder", "analysis"],
  },
  {
    id: "price-finder",
    label: "Price Finder",
    path: "/price-finder/",
    links: ["home", "product-db", "analysis", "price-finder"],
  },
];

const appById = new Map(apps.map((app) => [app.id, app]));

const appLinks: Record<AppId, string> = {
  home: "/",
  "product-db": "/product-db/",
  analysis: "/analysis/",
  "price-finder": "/price-finder/",
};

const appLabels: Record<AppId, string> = {
  home: "Home",
  "product-db": "Product Database",
  analysis: "Competition Analysis",
  "price-finder": "Price Finder",
};

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function mockAuthenticatedUser(page: Page) {
  await page.route("**/api/auth/user", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: "browser-regression-user",
          email: "browser-regression@example.test",
          firstName: "Browser",
          lastName: "Regression",
        },
      }),
    });
  });
}

function appSwitcherLink(
  page: Page,
  source: AppId,
  destination: AppId,
  mobile: boolean,
) {
  const href = appLinks[destination];

  if (source === "home") {
    const navigation = mobile
      ? page.locator("#mobile-nav")
      : page.locator('nav[aria-label="Workspace navigation"]:visible');
    return navigation.locator(`a[href="${href}"]`);
  }

  if (source === "product-db") {
    const navigation = mobile
      ? page.locator("#product-db-mobile-navigation")
      : page.locator("aside:visible").filter({ hasText: "Switch app" });
    return navigation
      .locator(`a[href="${href}"]`)
      .filter({ hasText: appLabels[destination] });
  }

  if (source === "analysis") {
    const navigation = mobile
      ? page.locator("#mobile-nav-drawer")
      : page.locator("aside:not(#mobile-nav-drawer):visible");
    return navigation
      .locator(`a[href="${href}"]`)
      .filter({ hasText: appLabels[destination] });
  }

  const navigation = mobile
    ? page.locator("#price-finder-mobile-navigation")
    : page.locator("nav:visible").first();
  return navigation
    .locator(`a[href="${href}"]`)
    .filter({ hasText: appLabels[destination] });
}

async function openMobileNavigation(page: Page, source: AppId) {
  const labels: Record<AppId, string> = {
    home: "Open navigation menu",
    "product-db": "Open navigation",
    analysis: "Open navigation menu",
    "price-finder": "Open navigation",
  };

  await page.getByRole("button", { name: labels[source] }).click();
}

async function expectDestinationActive(
  page: Page,
  destination: AppId,
  mobile: boolean,
) {
  if (mobile) await openMobileNavigation(page, destination);

  if (destination === "home") {
    const navigation = mobile
      ? page.locator("#mobile-nav")
      : page.locator('nav[aria-label="Workspace navigation"]:visible');
    await expect(
      navigation.locator('a[href="/"][aria-current="page"]'),
    ).toBeVisible();
    return;
  }

  if (destination === "product-db") {
    const catalogLink = page
      .locator('a[href="/product-db/"]:visible')
      .filter({ hasText: "Catalog" });
    await expect(catalogLink).toBeVisible();
    await expect(catalogLink.locator("span").first()).toHaveClass(
      /bg-white\/90/,
    );
    return;
  }

  if (destination === "analysis") {
    const navigation = mobile
      ? page.locator("#mobile-nav-drawer")
      : page.locator("aside:not(#mobile-nav-drawer):visible");
    const activeLink = navigation
      .locator('a[href="/analysis/"]')
      .filter({ hasText: "Active" });
    await expect(activeLink).toBeVisible();
    await expect(activeLink).toHaveClass(/text-primary/);
    return;
  }

  const navigation = mobile
    ? page.locator("#price-finder-mobile-navigation")
    : page.locator("nav:visible").first();
  await expect(
    navigation.locator('a[href="/price-finder/"][aria-current="page"]'),
  ).toBeVisible();
}

for (const source of apps) {
  test(`${source.label} app switcher links land on the right app`, async ({
    page,
  }, testInfo) => {
    const mobile = testInfo.project.name === "mobile";
    await mockAuthenticatedUser(page);

    for (const destinationId of source.links) {
      const destination = appById.get(destinationId);
      if (!destination)
        throw new Error(`Unknown destination app: ${destinationId}`);

      await page.goto(source.path);

      if (mobile) await openMobileNavigation(page, source.id);

      const link = appSwitcherLink(page, source.id, destination.id, mobile);
      await expect(link).toBeVisible();

      const expectedUrl = new URL(destination.path, page.url()).toString();
      await link.click();
      await expect(page).toHaveURL(new RegExp(`${escapeRegExp(expectedUrl)}$`));
      await expectDestinationActive(page, destination.id, mobile);
    }
  });
}

test("legacy Product Database Price Finder links preserve query strings and hashes", async ({
  page,
}, testInfo) => {
  await mockAuthenticatedUser(page);

  await page.goto("/product-db/price-finder?source=import&batch=42#review");
  await expect(page).toHaveURL(
    /\/price-finder\/\?source=import&batch=42#review$/,
  );
  await expectDestinationActive(
    page,
    "price-finder",
    testInfo.project.name === "mobile",
  );
});
