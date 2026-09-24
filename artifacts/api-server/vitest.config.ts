import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Run before test files are imported; individual beforeAll guards are too late.
    globalSetup: ["./src/testDatabaseGuard.ts"],
  },
});