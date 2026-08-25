-- One-time, privileged cleanup for superseded Sparsh Pearl Vol 6.2 imports.
--
-- Run only through an authorized writable production PostgreSQL connection.
-- This does not delete import batches or staging rows. It only marks the two
-- pending upload records at the upload date as discarded and records why.
--
-- The script is idempotent: a repeat run confirms the two records are already
-- discarded, or aborts without committing if the production state is different
-- from the reviewed state.

BEGIN;

DO $$
DECLARE
  pending_count bigint;
  discarded_count bigint;
  approved_source_count bigint;
  approved_target_count bigint;
  source_price_rows bigint;
  target_price_rows bigint;
  updated_count bigint;
  expected_reason text := 'Vol 6.2 is effective 2026-09-01, already correctly applied in production. These three batches hold the same contents under wrong dates (2026-08-20 was the upload date; 2026-03-05 was the borrowed Prayag PTMT period). Preserve the earlier approved Sparsh period at 2026-03-05 unchanged.';
BEGIN
  PERFORM pg_advisory_xact_lock(917132);

  SELECT COUNT(*)
  INTO pending_count
  FROM import_batches
  WHERE competitor = 'Sparsh Pearl'
    AND effective_date = DATE '2026-08-20'
    AND status = 'pending';

  SELECT COUNT(*)
  INTO discarded_count
  FROM import_batches
  WHERE competitor = 'Sparsh Pearl'
    AND effective_date = DATE '2026-08-20'
    AND status = 'discarded';

  SELECT COUNT(*)
  INTO approved_source_count
  FROM import_batches
  WHERE competitor = 'Sparsh Pearl'
    AND effective_date = DATE '2026-08-20'
    AND status = 'approved';

  SELECT COUNT(*)
  INTO approved_target_count
  FROM import_batches
  WHERE competitor = 'Sparsh Pearl'
    AND effective_date = DATE '2026-09-01'
    AND status = 'approved';

  SELECT COUNT(*)
  INTO source_price_rows
  FROM competitor_prices
  WHERE competitor = 'Sparsh Pearl'
    AND effective_date = DATE '2026-08-20';

  SELECT COUNT(*)
  INTO target_price_rows
  FROM competitor_prices
  WHERE competitor = 'Sparsh Pearl'
    AND effective_date = DATE '2026-09-01';

  -- A prior successful run must have left exactly the two discarded records
  -- and must not have altered the approved/current price periods.
  IF pending_count = 0
     AND discarded_count = 2
     AND approved_source_count = 0
     AND approved_target_count = 1
     AND source_price_rows = 0
     AND target_price_rows = 150 THEN
    IF EXISTS (
      SELECT 1
      FROM import_batches
      WHERE competitor = 'Sparsh Pearl'
        AND effective_date = DATE '2026-08-20'
        AND status = 'discarded'
        AND COALESCE(row_counts::jsonb ->> 'discardReason', '') <> expected_reason
    ) THEN
      RAISE EXCEPTION 'Sparsh pending cleanup has an unexpected discard reason';
    END IF;
    RETURN;
  END IF;

  IF pending_count <> 2
     OR discarded_count <> 0
     OR approved_source_count <> 0
     OR approved_target_count <> 1
     OR source_price_rows <> 0
     OR target_price_rows <> 150 THEN
    RAISE EXCEPTION
      'Refusing Sparsh pending cleanup: expected 2 pending and 0 discarded batches at 2026-08-20, 0 approved source rows, 1 approved target batch, 0 source prices, and 150 target prices; found pending %, discarded %, approved source batches %, approved target batches %, source prices %, target prices %',
      pending_count, discarded_count, approved_source_count,
      approved_target_count, source_price_rows, target_price_rows;
  END IF;

  UPDATE import_batches
  SET
    status = 'discarded',
    row_counts = (
      COALESCE(row_counts::jsonb, '{}'::jsonb)
      || jsonb_build_object(
        'discardReason', expected_reason,
        'discardedAt', to_char(
          CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      )
    )::text
  WHERE competitor = 'Sparsh Pearl'
    AND effective_date = DATE '2026-08-20'
    AND status = 'pending';

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 2 THEN
    RAISE EXCEPTION 'Sparsh pending cleanup updated %, expected 2', updated_count;
  END IF;
END $$;

COMMIT;