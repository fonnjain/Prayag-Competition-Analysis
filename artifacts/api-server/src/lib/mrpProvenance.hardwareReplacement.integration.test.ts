import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  db,
  mrpLoadBatchesTable,
  mrpSourcesTable,
} from "@workspace/db";
import {
  parseAuthoritativeMasterBuffer,
} from "./authoritativeMrpMaster";
import {
  HARDWARE_REPLACEMENT_SNAPSHOT,
  sha256ForBuffer,
} from "./mrpProvenance";

const authoritativeMaster = readFileSync(
  new URL(
    "../../../../attached_assets/Prayag_MRP_Authoritative_01Sep2026_1788147614421.xlsx",
    import.meta.url,
  ),
);

describe("authoritative Hardware source replacement", () => {
  it("matches the verified master slice and leaves earlier periods on their original batches", async () => {
    expect(sha256ForBuffer(authoritativeMaster)).toBe(
      HARDWARE_REPLACEMENT_SNAPSHOT.fileSha256,
    );
    const parsed = parseAuthoritativeMasterBuffer(authoritativeMaster);
    expect(
      parsed.periodDivisionCounts[
        `${HARDWARE_REPLACEMENT_SNAPSHOT.effectiveDate} — Hardware`
      ],
    ).toBe(HARDWARE_REPLACEMENT_SNAPSHOT.expectedRows);

    const batches = await db
      .select({
        id: mrpLoadBatchesTable.id,
        fileName: mrpLoadBatchesTable.fileName,
        fileSha256: mrpLoadBatchesTable.fileSha256,
        downloadedAt: mrpLoadBatchesTable.downloadedAt,
        rowCount: mrpLoadBatchesTable.rowCount,
      })
      .from(mrpLoadBatchesTable)
      .innerJoin(
        mrpSourcesTable,
        eq(mrpSourcesTable.id, mrpLoadBatchesTable.sourceId),
      )
      .where(
        and(
          eq(mrpSourcesTable.division, "Hardware"),
          eq(
            mrpLoadBatchesTable.fileSha256,
            HARDWARE_REPLACEMENT_SNAPSHOT.fileSha256,
          ),
        ),
      );
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({
      fileName: HARDWARE_REPLACEMENT_SNAPSHOT.fileName,
      fileSha256: HARDWARE_REPLACEMENT_SNAPSHOT.fileSha256,
      downloadedAt: HARDWARE_REPLACEMENT_SNAPSHOT.downloadedAt,
      rowCount: HARDWARE_REPLACEMENT_SNAPSHOT.expectedRows,
    });

    const links = await db.execute<{
      replacementRows: number;
      unrelatedRows: number;
      earlierHardwareRows: number;
      earlierRowsMoved: number;
    }>(sql`
      SELECT
        COUNT(*) FILTER (
          WHERE h.effective_date = ${HARDWARE_REPLACEMENT_SNAPSHOT.effectiveDate}
            AND h.load_batch_id = ${batches[0]!.id}
        )::int AS "replacementRows",
        COUNT(*) FILTER (
          WHERE h.effective_date <> ${HARDWARE_REPLACEMENT_SNAPSHOT.effectiveDate}
            AND h.load_batch_id = ${batches[0]!.id}
        )::int AS "unrelatedRows",
        COUNT(*) FILTER (
          WHERE h.effective_date < ${HARDWARE_REPLACEMENT_SNAPSHOT.effectiveDate}
        )::int AS "earlierHardwareRows",
        COUNT(*) FILTER (
          WHERE h.effective_date < ${HARDWARE_REPLACEMENT_SNAPSHOT.effectiveDate}
            AND h.load_batch_id = ${batches[0]!.id}
        )::int AS "earlierRowsMoved"
      FROM mrp_price_history h
      JOIN catalog_products p ON p.item_code = h.item_code
      WHERE p.division = 'Hardware'
        AND h.variant = 'Standard'
    `);
    expect(links.rows[0]).toEqual({
      replacementRows: HARDWARE_REPLACEMENT_SNAPSHOT.expectedRows,
      unrelatedRows: 0,
      earlierHardwareRows: 554,
      earlierRowsMoved: 0,
    });
  });
});