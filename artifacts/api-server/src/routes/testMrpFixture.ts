import { eq } from "drizzle-orm";
import {
  db,
  mrpHistoryProvenanceEventsTable,
  mrpLoadBatchesTable,
  mrpPriceHistoryTable,
  mrpSourcesTable,
} from "@workspace/db";

export async function createMrpFixtureBatch(name: string, run: number): Promise<number> {
  const [source] = await db
    .select({ id: mrpSourcesTable.id })
    .from(mrpSourcesTable)
    .where(eq(mrpSourcesTable.division, "PTMT & Plastic Fittings"))
    .limit(1);
  if (!source) throw new Error("PTMT fixture source is unavailable");
  const [batch] = await db
    .insert(mrpLoadBatchesTable)
    .values({
      sourceId: source.id,
      fileName: `fixture-${name}-${run}.xlsx`,
      fileSha256: `fixture-${name}-${run}`,
      fileSizeBytes: 0,
      downloadedAt: "2026-01-01",
      notes: "Integration-test fixture batch",
    })
    .returning({ id: mrpLoadBatchesTable.id });
  if (!batch) throw new Error("Unable to create MRP fixture batch");
  return batch.id;
}

export async function deleteMrpFixtureBatch(id: number): Promise<void> {
  await db.delete(mrpHistoryProvenanceEventsTable)
    .where(eq(mrpHistoryProvenanceEventsTable.loadBatchId, id));
  await db.delete(mrpPriceHistoryTable)
    .where(eq(mrpPriceHistoryTable.loadBatchId, id));
  await db.delete(mrpLoadBatchesTable).where(eq(mrpLoadBatchesTable.id, id));
}