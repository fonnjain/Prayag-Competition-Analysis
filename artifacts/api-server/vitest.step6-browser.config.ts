import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/step6BrowserHarness.browser.ts"],
    globalSetup: ["./src/testDatabaseGuard.ts"],
    setupFiles: ["./src/p051PrivateCatalogueSetup.ts"],
    fileParallelism: false,
    sequence: { hooks: "stack" },
    testTimeout: 1260000, hookTimeout: 60000,
  },
});
