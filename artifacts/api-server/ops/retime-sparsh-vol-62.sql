-- One-time, privileged correction for the verified Sparsh Pearl Vol 6.2 period.
--
-- Run only through an authorized writable PostgreSQL connection. This script is
-- intentionally not part of application startup. It is idempotent: it either
-- applies the exact verified 150-row correction, confirms the completed state,
-- or aborts without committing when the data does not match the expected source.

BEGIN;

DO $$
DECLARE
  source_rows bigint;
  target_rows bigint;
  source_bcc_301 numeric;
  target_bcc_301 numeric;
  source_batch_count bigint;
  target_batch_count bigint;
  source_batch_id integer;
BEGIN
  PERFORM pg_advisory_xact_lock(917131);

  SELECT
    COUNT(*),
    MAX(price) FILTER (WHERE competitor_code = 'BCC-301')
  INTO source_rows, source_bcc_301
  FROM competitor_prices
  WHERE competitor = 'Sparsh Pearl'
    AND effective_date = DATE '2026-08-20';

  SELECT
    COUNT(*),
    MAX(price) FILTER (WHERE competitor_code = 'BCC-301')
  INTO target_rows, target_bcc_301
  FROM competitor_prices
  WHERE competitor = 'Sparsh Pearl'
    AND effective_date = DATE '2026-09-01';

  SELECT COUNT(*), MIN(id)
  INTO source_batch_count, source_batch_id
  FROM import_batches
  WHERE competitor = 'Sparsh Pearl'
    AND effective_date = DATE '2026-08-20'
    AND status = 'approved';

  SELECT COUNT(*)
  INTO target_batch_count
  FROM import_batches
  WHERE competitor = 'Sparsh Pearl'
    AND effective_date = DATE '2026-09-01'
    AND status = 'approved';

  -- A prior successful run must be complete, including the moved approved batch.
  IF source_rows = 0 AND target_rows = 150 THEN
    IF target_bcc_301 IS DISTINCT FROM 330 OR target_batch_count <> 1 THEN
      RAISE EXCEPTION
        'Sparsh Vol 6.2 correction has an unexpected completed state (target rows %, BCC-301 %, approved target batches %)',
        target_rows, target_bcc_301, target_batch_count;
    END IF;
    RETURN;
  END IF;

  IF source_rows <> 150
     OR target_rows <> 0
     OR source_bcc_301 IS DISTINCT FROM 330
     OR source_batch_count <> 1 THEN
    RAISE EXCEPTION
      'Refusing Sparsh Vol 6.2 correction: expected 150 rows and BCC-301 ₹330 at 2026-08-20, no 2026-09-01 rows, and one approved source batch; found source rows %, target rows %, source BCC-301 %, source batches %',
      source_rows, target_rows, source_bcc_301, source_batch_count;
  END IF;

  UPDATE competitor_prices
  SET effective_date = DATE '2026-09-01',
      is_current = false
  WHERE competitor = 'Sparsh Pearl'
    AND effective_date = DATE '2026-08-20';

  UPDATE import_batches
  SET
    effective_date = DATE '2026-09-01',
    row_counts = (
      COALESCE(row_counts::jsonb, '{}'::jsonb)
      || jsonb_build_object(
        'dataOperations',
        COALESCE(row_counts::jsonb -> 'dataOperations', '[]'::jsonb)
        || jsonb_build_array(jsonb_build_object(
          'type', 'effective_date_correction',
          'fromEffectiveDate', '2026-08-20',
          'toEffectiveDate', '2026-09-01',
          'rowCount', 150,
          'verificationCode', 'BCC-301',
          'verificationPrice', 330,
          'reason', 'Vol 6.2 was verified as effective 2026-09-01; the earlier 2026-03-05 Sparsh period remains unchanged.',
          'recordedAt', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        ))
      )
    )::text
  WHERE id = source_batch_id;

  -- Match the existing period-aware current-flag policy without changing any
  -- prices outside this competitor.
  UPDATE competitor_prices
  SET is_current = false
  WHERE competitor = 'Sparsh Pearl';

  UPDATE competitor_prices
  SET is_current = true
  WHERE id IN (
    SELECT DISTINCT ON (competitor, matched_prayag_code) id
    FROM competitor_prices
    WHERE competitor = 'Sparsh Pearl'
      AND matched_prayag_code IS NOT NULL
      AND effective_date <= CURRENT_DATE
    ORDER BY competitor, matched_prayag_code, effective_date DESC NULLS LAST, id DESC
  );

  UPDATE competitor_prices
  SET is_current = true
  WHERE competitor = 'Sparsh Pearl'
    AND matched_prayag_code IS NULL
    AND effective_date = (
      SELECT MAX(effective_date)
      FROM competitor_prices
      WHERE competitor = 'Sparsh Pearl'
        AND matched_prayag_code IS NULL
        AND effective_date <= CURRENT_DATE
    );
END $$;

COMMIT;