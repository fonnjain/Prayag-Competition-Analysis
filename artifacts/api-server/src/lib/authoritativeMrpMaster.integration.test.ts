import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  catalogProductsTable,
  db,
  mrpHistoryProvenanceEventsTable,
  mrpLoadBatchesTable,
  mrpPriceHistoryTable,
  pool,
} from "@workspace/db";
import * as schema from "@workspace/db/schema";
import {
  AUTHORITATIVE_MASTER_FILE_NAME,
  AUTHORITATIVE_MASTER_SHA256,
  AUTHORITATIVE_MASTER_V2_FILE_NAME,
  AUTHORITATIVE_MASTER_V2_SHA256,
  loadAuthoritativeMaster,
  parseAuthoritativeMasterBuffer,
} from "./authoritativeMrpMaster";
import type { DatabaseTransaction } from "./catalog";
import { sha256ForBuffer } from "./mrpProvenance";

const MASTER_FILE = new URL(
  "../../../../attached_assets/Prayag_MRP_Authoritative_01Sep2026_1788147614421.xlsx",
  import.meta.url,
);
const MASTER_BUFFER = readFileSync(MASTER_FILE);
const MASTER_V2_FILE = new URL(
  "../../../../attached_assets/Prayag_MRP_Authoritative_v2_01Sep2026_1788783858192.xlsx",
  import.meta.url,
);
const MASTER_V2_BUFFER = readFileSync(MASTER_V2_FILE);
const RUN = Date.now();
const DISPOSABLE_SCHEMA = `authoritative_load_test_${RUN}`;
const ROLLBACK_MARKER = `authoritative-load-test-rollback-${RUN}`;
const FAILURE_FUNCTION = `authoritative_load_test_failure_${RUN}`;
const FAILURE_TRIGGER = `authoritative_load_test_failure_trigger_${RUN}`;
type PoolConnectCallback = Parameters<typeof pool.connect>[0];
type PoolClient = PoolConnectCallback extends (
  ...args: infer Arguments
) => void
  ? Arguments[1]
  : never;
const DEACTIVATED_CODES = [
  "PS1106",
  "PS1606",
  "PS5157",
  "PS5163",
  "PS5171",
  "PS5657",
  "PS5763",
  "PS7506",
] as const;
const V2_NEW_CODES = [
  "PF306",
  "PF326",
  "PF51",
  "PF525",
  "PF608",
  "PF609",
  "PF61",
  "PF610",
  "PF611",
  "PF71",
  "PG306",
  "PG326",
  "PG51",
  "PG525",
  "PG608",
  "PG609",
  "PG61",
  "PG610",
  "PG611",
  "PG71",
  "PP306",
  "PP326",
  "PP51",
  "PP525",
  "PP608",
  "PP609",
  "PP61",
  "PP610",
  "PP611",
  "PP71",
] as const;
let firstClient: PoolClient | null = null;
let secondClient: PoolClient | null = null;
let firstDatabase: Omit<typeof db, "$client">;
let secondDatabase: Omit<typeof db, "$client">;

async function removeExistingAuthoritativeBatches(
  tx: DatabaseTransaction,
  fileSha256: string = AUTHORITATIVE_MASTER_SHA256,
): Promise<void> {
  const batches = await tx
    .select({ id: mrpLoadBatchesTable.id })
    .from(mrpLoadBatchesTable)
    .where(eq(mrpLoadBatchesTable.fileSha256, fileSha256));
  const batchIds = batches.map((batch) => batch.id);
  if (batchIds.length === 0) return;

  await tx
    .delete(mrpHistoryProvenanceEventsTable)
    .where(inArray(mrpHistoryProvenanceEventsTable.loadBatchId, batchIds));
  await tx
    .delete(mrpPriceHistoryTable)
    .where(inArray(mrpPriceHistoryTable.loadBatchId, batchIds));
  await tx
    .delete(mrpLoadBatchesTable)
    .where(inArray(mrpLoadBatchesTable.id, batchIds));
}

async function tableSnapshot(
  tx: DatabaseTransaction,
) {
  const result = await tx.execute<{
    catalog_count: number;
    catalog_digest: string;
    history_count: number;
    history_digest: string;
    provenance_count: number;
    provenance_digest: string;
    batch_count: number;
    batch_digest: string;
  }>(sql`
    SELECT
      (SELECT COUNT(*)::int FROM catalog_products) AS catalog_count,
      (SELECT md5(COALESCE(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), ''))
         FROM catalog_products p) AS catalog_digest,
      (SELECT COUNT(*)::int FROM mrp_price_history) AS history_count,
      (SELECT md5(COALESCE(string_agg(to_jsonb(h)::text, '|' ORDER BY h.id), ''))
         FROM mrp_price_history h) AS history_digest,
      (SELECT COUNT(*)::int FROM mrp_history_provenance_events) AS provenance_count,
      (SELECT md5(COALESCE(string_agg(to_jsonb(e)::text, '|' ORDER BY e.id), ''))
         FROM mrp_history_provenance_events e) AS provenance_digest,
      (SELECT COUNT(*)::int FROM mrp_load_batches) AS batch_count,
      (SELECT md5(COALESCE(string_agg(to_jsonb(b)::text, '|' ORDER BY b.id), ''))
         FROM mrp_load_batches b) AS batch_digest
  `);
  return result.rows[0]!;
}

beforeAll(async () => {
  await db.execute(
    sql.raw(`
      CREATE SCHEMA ${DISPOSABLE_SCHEMA};

      CREATE TABLE ${DISPOSABLE_SCHEMA}.catalog_products
        (LIKE public.catalog_products INCLUDING ALL);
      CREATE TABLE ${DISPOSABLE_SCHEMA}.mrp_sources
        (LIKE public.mrp_sources INCLUDING ALL);
      CREATE TABLE ${DISPOSABLE_SCHEMA}.mrp_load_batches
        (LIKE public.mrp_load_batches INCLUDING ALL);
      CREATE TABLE ${DISPOSABLE_SCHEMA}.mrp_price_history
        (LIKE public.mrp_price_history INCLUDING ALL);
      CREATE TABLE ${DISPOSABLE_SCHEMA}.mrp_history_provenance_events
        (LIKE public.mrp_history_provenance_events INCLUDING ALL);

      CREATE SEQUENCE ${DISPOSABLE_SCHEMA}.catalog_products_id_seq
        OWNED BY ${DISPOSABLE_SCHEMA}.catalog_products.id;
      CREATE SEQUENCE ${DISPOSABLE_SCHEMA}.mrp_sources_id_seq
        OWNED BY ${DISPOSABLE_SCHEMA}.mrp_sources.id;
      CREATE SEQUENCE ${DISPOSABLE_SCHEMA}.mrp_load_batches_id_seq
        OWNED BY ${DISPOSABLE_SCHEMA}.mrp_load_batches.id;
      CREATE SEQUENCE ${DISPOSABLE_SCHEMA}.mrp_price_history_id_seq
        OWNED BY ${DISPOSABLE_SCHEMA}.mrp_price_history.id;
      CREATE SEQUENCE ${DISPOSABLE_SCHEMA}.mrp_history_provenance_events_id_seq
        OWNED BY ${DISPOSABLE_SCHEMA}.mrp_history_provenance_events.id;

      ALTER TABLE ${DISPOSABLE_SCHEMA}.catalog_products
        ALTER COLUMN id SET DEFAULT nextval('${DISPOSABLE_SCHEMA}.catalog_products_id_seq');
      ALTER TABLE ${DISPOSABLE_SCHEMA}.mrp_sources
        ALTER COLUMN id SET DEFAULT nextval('${DISPOSABLE_SCHEMA}.mrp_sources_id_seq');
      ALTER TABLE ${DISPOSABLE_SCHEMA}.mrp_load_batches
        ALTER COLUMN id SET DEFAULT nextval('${DISPOSABLE_SCHEMA}.mrp_load_batches_id_seq');
      ALTER TABLE ${DISPOSABLE_SCHEMA}.mrp_price_history
        ALTER COLUMN id SET DEFAULT nextval('${DISPOSABLE_SCHEMA}.mrp_price_history_id_seq');
      ALTER TABLE ${DISPOSABLE_SCHEMA}.mrp_history_provenance_events
        ALTER COLUMN id SET DEFAULT nextval('${DISPOSABLE_SCHEMA}.mrp_history_provenance_events_id_seq');

      INSERT INTO ${DISPOSABLE_SCHEMA}.catalog_products
      SELECT * FROM public.catalog_products;
      SELECT setval(
        '${DISPOSABLE_SCHEMA}.catalog_products_id_seq',
        (SELECT MAX(id) + 1 FROM ${DISPOSABLE_SCHEMA}.catalog_products),
        false
      );

      INSERT INTO ${DISPOSABLE_SCHEMA}.mrp_sources (
        division, sheet_id, sheet_url, expected_file_name, source_kind
      ) VALUES (
        'Authoritative rollback fixture',
        'authoritative-rollback-fixture',
        'internal://authoritative-rollback-fixture',
        'authoritative-rollback-baseline.xlsx',
        'test'
      );
      INSERT INTO ${DISPOSABLE_SCHEMA}.mrp_load_batches (
        source_id, file_name, file_sha256, file_size_bytes, downloaded_at,
        row_count, notes
      ) SELECT
        id,
        'authoritative-rollback-baseline.xlsx',
        'authoritative-rollback-baseline',
        0,
        '2026-03-01',
        1,
        'Integration-test rollback baseline'
      FROM ${DISPOSABLE_SCHEMA}.mrp_sources
      WHERE sheet_id = 'authoritative-rollback-fixture';

      INSERT INTO ${DISPOSABLE_SCHEMA}.mrp_price_history (
        item_code,
        mrp,
        price_basis,
        effective_date,
        load_date,
        source_file,
        is_current,
        review_status,
        load_batch_id,
        variant
      ) VALUES (
        'CCL-60-BSK',
        1080,
        'MRP',
        '2026-03-01',
        '2026-03-01',
        'authoritative-rollback-baseline.xlsx',
        true,
        'approved',
        (SELECT id FROM ${DISPOSABLE_SCHEMA}.mrp_load_batches
         WHERE file_sha256 = 'authoritative-rollback-baseline'),
        'Standard'
      );
    `),
  );

  firstClient = await pool.connect();
  secondClient = await pool.connect();
  await Promise.all([
    firstClient.query(`SET search_path TO ${DISPOSABLE_SCHEMA}, public`),
    secondClient.query(`SET search_path TO ${DISPOSABLE_SCHEMA}, public`),
  ]);
  firstDatabase = drizzle(firstClient, { schema });
  secondDatabase = drizzle(secondClient, { schema });
});

afterAll(async () => {
  firstClient?.release(true);
  secondClient?.release(true);
  await db.execute(sql.raw(`DROP SCHEMA IF EXISTS ${DISPOSABLE_SCHEMA} CASCADE`));
});

describe("authoritative MRP master transaction guarantees", () => {
  it(
    "loads revised v2 while visibly preserving the named audited names",
    async () => {
      expect(sha256ForBuffer(MASTER_V2_BUFFER)).toBe(
        AUTHORITATIVE_MASTER_V2_SHA256,
      );
      const parsed = parseAuthoritativeMasterBuffer(MASTER_V2_BUFFER);
      expect(parsed.productRows).toHaveLength(6_106);
      expect(parsed.priceRows).toHaveLength(6_256);
      expect(parsed.discontinuedRows).toHaveLength(233);
      expect(parsed.excludedRows).toBe(142);
      expect(parsed.periodCounts).toEqual({
        "2024-02-15": 161,
        "2026-02-01": 1_616,
        "2026-05-01": 475,
        "2026-08-01": 865,
        "2026-08-10": 580,
        "2026-09-01": 2_409,
      });
      expect(parsed.preservedNameDisagreements).toHaveLength(11);

      await expect(
        firstDatabase.transaction(async (tx) => {
          await removeExistingAuthoritativeBatches(
            tx,
            AUTHORITATIVE_MASTER_V2_SHA256,
          );
          await tx
            .delete(catalogProductsTable)
            .where(inArray(catalogProductsTable.itemCode, [...V2_NEW_CODES]));
          const catalogCodesBefore = new Set(
            (
              await tx
                .select({ itemCode: catalogProductsTable.itemCode })
                .from(catalogProductsTable)
            ).map((row) => row.itemCode),
          );
          const [vbBefore] = (
            await tx.execute<{ count: number }>(sql`
              SELECT COUNT(*)::int AS count
              FROM catalog_products
              WHERE item_code IN (
                '121-VB', '124-VB', '127-VB', '129-VB', '130-VB',
                '132-VB', '1322-VB', '133-VB', '134-VB', '135-VB',
                '1375-VB', '144-VB', '145-VB', '147-VB', '149-VB'
              )
            `)
          ).rows;
          const result = await loadAuthoritativeMaster({
            buffer: MASTER_V2_BUFFER,
            downloadedAt: "2026-09-07",
            loadedBy: "authoritative-v2-load-test",
            transaction: tx,
          });
          expect(result.duplicate).toBe(false);
          if (result.duplicate) return;

          expect(result.productRows).toBe(6_106);
          expect(result.priceRows).toBe(6_256);
          expect(result.periodCounts["2026-08-10"]).toBe(580);
          expect(new Set(result.newCodes)).toEqual(new Set(V2_NEW_CODES));
          const finalStateNewCodes = (
            await tx
              .select({ itemCode: catalogProductsTable.itemCode })
              .from(catalogProductsTable)
          )
            .map((row) => row.itemCode)
            .filter((itemCode) => !catalogCodesBefore.has(itemCode));
          expect(new Set(result.newCodes)).toEqual(new Set(finalStateNewCodes));
          expect(result.newCodes).toHaveLength(new Set(result.newCodes).size);
          expect(result.newCodes).toHaveLength(
            result.after.catalog_rows - result.before.catalog_rows,
          );
          expect(result.preservedNameDisagreements).toHaveLength(11);

          const [batch] = await tx
            .select()
            .from(mrpLoadBatchesTable)
            .where(eq(mrpLoadBatchesTable.id, result.loadBatchId));
          expect(batch).toMatchObject({
            fileName: AUTHORITATIVE_MASTER_V2_FILE_NAME,
            fileSha256: AUTHORITATIVE_MASTER_V2_SHA256,
            downloadedAt: "2026-09-07",
            rowCount: 6_256,
          });
          expect(batch?.notes).toContain(
            "Revised authoritative master from Prayag, superseding batch 15.",
          );
          expect(batch?.notes).toContain("Named product-name exceptions (11)");
          expect(batch?.notes).toContain("UH82-S");

          const exactRows = await tx
            .select({
              itemCode: mrpPriceHistoryTable.itemCode,
              mrp: mrpPriceHistoryTable.mrp,
              effectiveDate: mrpPriceHistoryTable.effectiveDate,
            })
            .from(mrpPriceHistoryTable)
            .where(
              and(
                eq(mrpPriceHistoryTable.loadBatchId, result.loadBatchId),
                inArray(mrpPriceHistoryTable.itemCode, [
                  "P10A12",
                  "BOS-108",
                  "P10A04",
                  "PF326",
                  "PF71",
                  "CCL-60-BSK",
                ]),
              ),
            );
          expect(exactRows).toEqual(
            expect.arrayContaining([
              {
                itemCode: "P10A12",
                mrp: 7_354,
                effectiveDate: "2026-08-10",
              },
              {
                itemCode: "BOS-108",
                mrp: 1_990,
                effectiveDate: "2026-08-01",
              },
              {
                itemCode: "P10A04",
                mrp: 168,
                effectiveDate: "2026-08-10",
              },
              {
                itemCode: "PF326",
                mrp: 515.2,
                effectiveDate: "2026-08-10",
              },
              {
                itemCode: "PF71",
                mrp: 10_060.2,
                effectiveDate: "2026-08-10",
              },
              {
                itemCode: "CCL-60-BSK",
                mrp: 1_190,
                effectiveDate: "2026-09-01",
              },
            ]),
          );

          const preservedNames = await tx
            .select({
              itemCode: catalogProductsTable.itemCode,
              productName: catalogProductsTable.productName,
            })
            .from(catalogProductsTable)
            .where(
              inArray(
                catalogProductsTable.itemCode,
                parsed.preservedNameDisagreements.map((row) => row.itemCode),
              ),
            );
          expect(
            preservedNames.every(
              (row) =>
                row.productName ===
                parsed.preservedNameDisagreements.find(
                  (expected) => expected.itemCode === row.itemCode,
                )?.preservedName,
            ),
          ).toBe(true);

          const [vbCount] = (
            await tx.execute<{ count: number }>(sql`
              SELECT COUNT(*)::int AS count
              FROM catalog_products
              WHERE item_code IN (
                '121-VB', '124-VB', '127-VB', '129-VB', '130-VB',
                '132-VB', '1322-VB', '133-VB', '134-VB', '135-VB',
                '1375-VB', '144-VB', '145-VB', '147-VB', '149-VB'
              )
            `)
          ).rows;
          expect(vbCount?.count).toBe(vbBefore?.count);

          throw new Error(`${ROLLBACK_MARKER}-v2`);
        }),
      ).rejects.toThrow(`${ROLLBACK_MARKER}-v2`);
    },
    120_000,
  );

  it(
    "persists exact prices, variants, withdrawals, deactivations, and provenance linkage",
    async () => {
      expect(sha256ForBuffer(MASTER_BUFFER)).toBe(AUTHORITATIVE_MASTER_SHA256);
      const parsed = parseAuthoritativeMasterBuffer(MASTER_BUFFER);

      await expect(
        firstDatabase.transaction(async (tx) => {
          await removeExistingAuthoritativeBatches(tx);
          await tx
            .delete(catalogProductsTable)
            .where(eq(catalogProductsTable.itemCode, "EP-GANESHA"));
          const catalogCodesBefore = new Set(
            (
              await tx
                .select({ itemCode: catalogProductsTable.itemCode })
                .from(catalogProductsTable)
            ).map((row) => row.itemCode),
          );
          const result = await loadAuthoritativeMaster(
            {
              buffer: MASTER_BUFFER,
              downloadedAt: "2026-08-31",
              loadedBy: "authoritative-load-test",
              transaction: tx,
            },
          );

          expect(result.duplicate).toBe(false);
          if (result.duplicate) return;
          expect(result.productRows).toBe(6_076);
          expect(result.priceRows).toBe(6_226);
          expect(result.discontinuedRows).toBe(233);
          expect(result.excludedRows).toBe(142);
          expect(result.newCodes).toContain("EP-GANESHA");
          expect(result.newCodes).toHaveLength(
            result.after.catalog_rows - result.before.catalog_rows,
          );
          const finalStateNewCodes = (
            await tx
              .select({ itemCode: catalogProductsTable.itemCode })
              .from(catalogProductsTable)
          )
            .map((row) => row.itemCode)
            .filter((itemCode) => !catalogCodesBefore.has(itemCode));
          expect(new Set(result.newCodes)).toEqual(new Set(finalStateNewCodes));
          expect(result.newCodes).toHaveLength(new Set(result.newCodes).size);
          expect(result.periodCounts).toEqual({
            "2024-02-15": 161,
            "2026-02-01": 1_685,
            "2026-05-01": 871,
            "2026-08-01": 865,
            "2026-08-10": 85,
            "2026-09-01": 2_409,
          });
          expect(result.variantCounts).toEqual({
            Standard: 6_076,
            Ivory: 118,
            "White with Jet": 19,
            "Pink / Green / Blue": 13,
          });

          const [batch] = await tx
            .select()
            .from(mrpLoadBatchesTable)
            .where(eq(mrpLoadBatchesTable.id, result.loadBatchId));
          expect(batch).toMatchObject({
            fileName: AUTHORITATIVE_MASTER_FILE_NAME,
            fileSha256: AUTHORITATIVE_MASTER_SHA256,
            downloadedAt: "2026-08-31",
            rowCount: 6_226,
            notes:
              "Authoritative master returned by Prayag, superseding the compiled 01 Sep list.",
          });

          const [counts] = (
            await tx.execute<{
              history_count: number;
              distinct_codes: number;
              null_batch_count: number;
              provenance_count: number;
            }>(sql`
              SELECT
                (SELECT COUNT(*)::int FROM mrp_price_history WHERE load_batch_id = ${result.loadBatchId}) AS history_count,
                (SELECT COUNT(DISTINCT item_code)::int FROM mrp_price_history WHERE load_batch_id = ${result.loadBatchId}) AS distinct_codes,
                (SELECT COUNT(*)::int FROM mrp_price_history WHERE source_file = ${AUTHORITATIVE_MASTER_FILE_NAME} AND load_batch_id IS NULL) AS null_batch_count,
                (SELECT COUNT(*)::int FROM mrp_history_provenance_events WHERE load_batch_id = ${result.loadBatchId}) AS provenance_count
            `)
          ).rows;
          expect(counts).toEqual({
            history_count: 6_226,
            distinct_codes: 6_076,
            null_batch_count: 0,
            provenance_count: 6_226,
          });

          const exactPrices = await tx
            .select({
              itemCode: mrpPriceHistoryTable.itemCode,
              effectiveDate: mrpPriceHistoryTable.effectiveDate,
              variant: mrpPriceHistoryTable.variant,
              mrp: mrpPriceHistoryTable.mrp,
              loadBatchId: mrpPriceHistoryTable.loadBatchId,
            })
            .from(mrpPriceHistoryTable)
            .where(
              and(
                eq(mrpPriceHistoryTable.loadBatchId, result.loadBatchId),
                inArray(mrpPriceHistoryTable.itemCode, [
                  "CCL-60-BSK",
                  "PEA-64B",
                  "PEA-55B",
                  "C71",
                  "WT-4LH-50",
                  "WT-4LH-05",
                  "1179",
                  "1181",
                  "4010",
                  "4270",
                ]),
              ),
            );
          expect(exactPrices).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                itemCode: "CCL-60-BSK",
                effectiveDate: "2026-09-01",
                variant: "Standard",
                mrp: 1_190,
                loadBatchId: result.loadBatchId,
              }),
              expect.objectContaining({
                itemCode: "PEA-64B",
                effectiveDate: "2026-02-01",
                variant: "Standard",
                mrp: 2_596,
              }),
              expect.objectContaining({
                itemCode: "PEA-55B",
                effectiveDate: "2026-02-01",
                variant: "Standard",
                mrp: 3_440,
              }),
              expect.objectContaining({
                itemCode: "C71",
                effectiveDate: "2026-02-01",
                variant: "Standard",
                mrp: 244,
              }),
              expect.objectContaining({
                itemCode: "WT-4LH-50",
                effectiveDate: "2026-02-01",
                variant: "Standard",
                mrp: 100_000,
              }),
              expect.objectContaining({
                itemCode: "WT-4LH-05",
                effectiveDate: "2026-02-01",
                variant: "Standard",
                mrp: 10_000,
              }),
              expect.objectContaining({
                itemCode: "1179",
                effectiveDate: "2026-09-01",
                variant: "Standard",
                mrp: 638,
              }),
              expect.objectContaining({
                itemCode: "1181",
                effectiveDate: "2026-09-01",
                variant: "Standard",
                mrp: 578,
              }),
              expect.objectContaining({
                itemCode: "4010",
                effectiveDate: "2026-05-01",
                variant: "Ivory",
                mrp: 2_580,
              }),
              expect.objectContaining({
                itemCode: "4270",
                effectiveDate: "2026-05-01",
                variant: "White with Jet",
                mrp: 15_200,
              }),
            ]),
          );

          const discontinued = await tx
            .select({
              itemCode: catalogProductsTable.itemCode,
              discontinuedFrom: catalogProductsTable.discontinuedFrom,
              discontinuedCheckedBy: catalogProductsTable.discontinuedCheckedBy,
              discontinuedStatusNote: catalogProductsTable.discontinuedStatusNote,
            })
            .from(catalogProductsTable)
            .where(
              inArray(
                catalogProductsTable.itemCode,
                parsed.discontinuedRows.map((row) => row.itemCode),
              ),
            );
          expect(discontinued).toHaveLength(233);
          expect(
            new Set(
              discontinued.map((row) =>
                JSON.stringify([
                  row.itemCode,
                  row.discontinuedFrom,
                  row.discontinuedCheckedBy,
                  row.discontinuedStatusNote,
                ]),
              ),
            ),
          ).toEqual(
            new Set(
              parsed.discontinuedRows.map((row) =>
                JSON.stringify([
                  row.itemCode,
                  row.discontinuedFrom,
                  row.checkedBy,
                  row.statusNote,
                ]),
              ),
            ),
          );

          const deactivated = await tx
            .select({
              itemCode: catalogProductsTable.itemCode,
              isActive: catalogProductsTable.isActive,
              dataFlag: catalogProductsTable.dataFlag,
            })
            .from(catalogProductsTable)
            .where(inArray(catalogProductsTable.itemCode, [...DEACTIVATED_CODES]));
          expect(deactivated).toHaveLength(DEACTIVATED_CODES.length);
          expect(deactivated).toEqual(
            expect.arrayContaining(
              DEACTIVATED_CODES.map((itemCode) => ({
                itemCode,
                isActive: false,
                dataFlag: "removed_by_authoritative_master_2026_09_01",
              })),
            ),
          );

          const [excludedHistory] = (
            await tx.execute<{ count: number }>(sql`
              SELECT COUNT(*)::int AS count
              FROM mrp_price_history
              WHERE load_batch_id = ${result.loadBatchId}
                AND item_code IN ('20', '25', '32')
            `)
          ).rows;
          expect(excludedHistory?.count).toBe(0);

          throw new Error(ROLLBACK_MARKER);
        }),
      ).rejects.toThrow(ROLLBACK_MARKER);
    },
    120_000,
  );

  it(
    "rolls back catalog, history, provenance, batches, and current flags after a forced failure",
    async () => {
      await firstDatabase.transaction(removeExistingAuthoritativeBatches);
      const before = await firstDatabase.transaction(tableSnapshot);
      await firstDatabase.execute(
        sql.raw(`
          CREATE OR REPLACE FUNCTION ${FAILURE_FUNCTION}()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            RAISE EXCEPTION 'forced authoritative failure';
          END;
          $$;
          DROP TRIGGER IF EXISTS ${FAILURE_TRIGGER} ON mrp_price_history;
          CREATE TRIGGER ${FAILURE_TRIGGER}
          AFTER UPDATE OF is_current ON mrp_price_history
          FOR EACH ROW EXECUTE FUNCTION ${FAILURE_FUNCTION}();
        `),
      );

      try {
        await expect(
          loadAuthoritativeMaster({
            buffer: MASTER_BUFFER,
            downloadedAt: "2026-08-31",
            loadedBy: "authoritative-load-test",
            database: firstDatabase,
          }),
        ).rejects.toThrow(/mrp_price_history/);
        const after = await firstDatabase.transaction(tableSnapshot);
        expect(after).toEqual(before);
      } finally {
        await firstDatabase.execute(
          sql.raw(`
            DROP TRIGGER IF EXISTS ${FAILURE_TRIGGER} ON mrp_price_history;
            DROP FUNCTION IF EXISTS ${FAILURE_FUNCTION}();
          `),
        );
      }
    },
    120_000,
  );

  it(
    "keeps concurrent authoritative retries at exactly one batch",
    async () => {
      const before = await firstDatabase
        .select({ id: mrpLoadBatchesTable.id })
        .from(mrpLoadBatchesTable)
        .where(eq(mrpLoadBatchesTable.fileSha256, AUTHORITATIVE_MASTER_SHA256));
      expect(before).toHaveLength(0);

      const results = await Promise.all([
        loadAuthoritativeMaster({
          buffer: MASTER_BUFFER,
          downloadedAt: "2026-08-31",
          loadedBy: "authoritative-load-concurrency-test",
          database: firstDatabase,
        }),
        loadAuthoritativeMaster({
          buffer: MASTER_BUFFER,
          downloadedAt: "2026-08-31",
          loadedBy: "authoritative-load-concurrency-test",
          database: secondDatabase,
        }),
      ]);

      expect(results).toHaveLength(2);
      expect(results.filter((result) => result.duplicate)).toHaveLength(1);
      expect(results.filter((result) => !result.duplicate)).toHaveLength(1);
      const after = await firstDatabase
        .select({ id: mrpLoadBatchesTable.id })
        .from(mrpLoadBatchesTable)
        .where(eq(mrpLoadBatchesTable.fileSha256, AUTHORITATIVE_MASTER_SHA256));
      expect(after).toHaveLength(1);
    },
    120_000,
  );
});