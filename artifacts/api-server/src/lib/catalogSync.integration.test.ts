import { describe, expect, it } from "vitest";
import {
  applyCatalogSyncBundle,
  exportCatalogSyncBundle,
  getCurrentCatalogSyncSummary,
  parseAndValidateCatalogSyncBundle,
  summarizeCatalogSyncBundle,
} from "./catalogSync";

describe.sequential("catalog sync live-size export", () => {
  (process.env.RUN_CATALOG_SYNC_LIVE_TEST === "1" ? it : it.skip)(
    "exports the current verified catalog as a signed bundle within the upload limit",
    async () => {
      process.env.SESSION_SECRET ||= "catalog-sync-integration-test-secret";
      const bundle = await exportCatalogSyncBundle();
      const serialized = Buffer.from(JSON.stringify(bundle));
      const validated = parseAndValidateCatalogSyncBundle(serialized);
      const summary = summarizeCatalogSyncBundle(validated);

      expect(serialized.byteLength).toBeLessThan(30 * 1024 * 1024);
      expect(summary.counts.catalogProducts).toBeGreaterThan(1_000);
      expect(summary.counts.mrpPriceHistory).toBeGreaterThan(1_000);
      expect(summary.counts.mrpLoadBatches).toBeGreaterThan(0);
      expect(summary.counts.competitorPrices).toBeGreaterThan(0);
      expect(summary.counts.competitorCodeAliases).toBeGreaterThan(0);
    },
    30_000,
  );

  (
    process.env.RUN_CATALOG_SYNC_LIVE_TEST === "1" &&
    process.env.RUN_CATALOG_SYNC_APPLY_TEST === "1"
      ? it
      : it.skip
  )(
    "rolls back a forced failure and applies the complete current catalog atomically",
    async () => {
      process.env.SESSION_SECRET ||= "catalog-sync-integration-test-secret";
      const bundle = parseAndValidateCatalogSyncBundle(
        Buffer.from(JSON.stringify(await exportCatalogSyncBundle())),
      );
      const before = await getCurrentCatalogSyncSummary();

      await expect(
        applyCatalogSyncBundle(
          bundle,
          "catalog-sync-test@prayagindia.com",
          "f".repeat(64),
        ),
      ).rejects.toThrow(/changed after preview/i);
      expect(await getCurrentCatalogSyncSummary()).toEqual(before);

      const broken = structuredClone(bundle);
      broken.data.catalogProducts[1]!.itemCode =
        broken.data.catalogProducts[0]!.itemCode;
      await expect(
        applyCatalogSyncBundle(
          broken,
          "catalog-sync-test@prayagindia.com",
          bundle.manifest.payloadSha256,
        ),
      ).rejects.toThrow();
      expect(await getCurrentCatalogSyncSummary()).toEqual(before);

      const result = await applyCatalogSyncBundle(
        bundle,
        "catalog-sync-test@prayagindia.com",
        bundle.manifest.payloadSha256,
      );
      expect(result.before).toEqual(before);
      expect(result.after).toEqual(before);
    },
    120_000,
  );
});