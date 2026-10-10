-- One-action guarded undo of the approved Astral/Jindal workbook batch.
-- DEVELOPMENT ONLY. The full inserted snapshot must still be unchanged.
-- Run as one statement; DO is atomic. It retains the load audit, marked undone.
DO $p055_undo$
DECLARE
  batch mrp_load_batches%ROWTYPE;
  metadata jsonb;
  live_snapshot jsonb;
  removed integer;
BEGIN
  IF current_database() NOT IN ('heliumdb', 'heliumdb_test') THEN
    RAISE EXCEPTION 'P055 undo refuses a non-development database';
  END IF;
  PERFORM set_config('TimeZone', 'UTC', true);
  PERFORM pg_advisory_xact_lock(hashtext('price-editor:vocabulary'));
  PERFORM pg_advisory_xact_lock(hashtext('competitor-current-flags:Astral'));
  PERFORM pg_advisory_xact_lock(hashtext('competitor-current-flags:Jindal'));
  LOCK TABLE competitor_prices IN SHARE ROW EXCLUSIVE MODE;
  SELECT b.* INTO STRICT batch
  FROM mrp_load_batches b JOIN mrp_sources s ON s.id = b.source_id
  WHERE s.sheet_id = 'p055-astral-jindal-master'
  FOR UPDATE OF b;
  metadata := batch.notes::jsonb;
  IF metadata->>'kind' <> 'P055-approved-competitor-load'
     OR metadata->>'status' <> 'applied'
     OR batch.row_count <> 1167 THEN
    RAISE EXCEPTION 'P055 batch is absent, already undone, or not the approved load';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id), '[]'::jsonb)
  INTO live_snapshot FROM competitor_prices c
  WHERE competitor IN ('Astral', 'Jindal');
  IF live_snapshot IS DISTINCT FROM metadata->'after_snapshot' THEN
    RAISE EXCEPTION 'P055 undo blocked: inserted rows or brand population changed';
  END IF;
  IF EXISTS (SELECT 1 FROM mrp_price_history WHERE load_batch_id = batch.id)
     OR EXISTS (SELECT 1 FROM competitor_prices
       WHERE load_batch_id = batch.id AND competitor NOT IN ('Astral', 'Jindal')) THEN
    RAISE EXCEPTION 'P055 undo blocked: unrelated rows reference this batch';
  END IF;
  DELETE FROM competitor_prices WHERE load_batch_id = batch.id;
  GET DIAGNOSTICS removed = ROW_COUNT;
  IF removed <> 1167 THEN
    RAISE EXCEPTION 'P055 undo count mismatch; transaction will roll back';
  END IF;
  UPDATE mrp_load_batches
  SET notes = (metadata || jsonb_build_object(
    'status', 'undone', 'undone_at', now(), 'removed_rows', removed))::text
  WHERE id = batch.id;
  RAISE NOTICE 'P055 development batch % undone: % rows removed', batch.id, removed;
END
$p055_undo$;
