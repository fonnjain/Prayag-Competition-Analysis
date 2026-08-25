# Sparsh Pearl Vol 6.2 effective-date correction

This one-time, privileged operation corrects the verified Vol 6.2 period from
20 August 2026 to 1 September 2026. It is deliberately **not** run by the API
server. Use `retime-sparsh-vol-62.sql` only through an authorized writable
database connection.

## Safety checks

The script runs as one transaction and refuses to write unless all of these are
true:

- Exactly 150 Sparsh Pearl rows exist at `2026-08-20`.
- No Sparsh Pearl rows exist at `2026-09-01`.
- `BCC-301` is ₹330 in the source period.
- Exactly one approved Sparsh Pearl import batch exists at the source date.

On success it moves only those 150 rows and that approved batch, preserves the
5 March 2026 period, appends an `effective_date_correction` event to the
existing batch audit JSON, and recomputes Sparsh current flags. A repeat run
only confirms the already-correct state; it never duplicates the audit event.

## Before and after verification

Run this read-only query before and after the script:

```sql
SELECT
  effective_date,
  COUNT(*) AS row_count,
  MAX(price) FILTER (WHERE competitor_code = 'BCC-301') AS bcc_301_price
FROM competitor_prices
WHERE competitor = 'Sparsh Pearl'
  AND effective_date IN (DATE '2026-03-05', DATE '2026-08-20', DATE '2026-09-01')
GROUP BY effective_date
ORDER BY effective_date;
```

The corrected result retains 150 rows at 5 March, has no rows at 20 August,
and has 150 rows at 1 September with BCC-301 at ₹330. Confirm the moved,
approved batch contains the audit event before closing the operation.

## Rollback

Only if the before/after verification reveals an error, run the inverse update
as an authorized transaction: move the exact 150 rows and the same approved
batch from 1 September back to 20 August, then recompute Sparsh current flags.
Do not use the rollback to alter the preserved 5 March period.