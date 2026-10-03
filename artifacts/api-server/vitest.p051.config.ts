import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globalSetup: ["./src/testDatabaseGuard.ts"],
    setupFiles: ["./src/p051PrivateCatalogueSetup.ts"],
    fileParallelism: false,
    sequence: { hooks: "stack" },
    testTimeout: 60000, hookTimeout: 60000,
  },
});