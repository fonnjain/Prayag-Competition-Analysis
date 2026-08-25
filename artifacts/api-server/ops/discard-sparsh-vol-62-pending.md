# Sparsh Pearl Vol 6.2 pending-batch cleanup

This one-time, privileged operation marks the two pending Vol 6.2 imports
dated 20 August 2026 as **discarded**. The date was the upload date, not the
verified effective date of 1 September 2026.

The operation preserves the import batch records and all staging rows for
auditability. It does not delete data, alter competitor price rows, or touch
the earlier approved Sparsh period at 5 March 2026.

Run `discard-sparsh-vol-62-pending.sql` only through an authorized writable
production PostgreSQL connection. The script is transactional, guarded against
unexpected production state, and idempotent.

## Expected verification

Before and after the script, this query should show:

```sql
SELECT
  effective_date,
  status,
  COUNT(*) AS batch_count
FROM import_batches
WHERE competitor = 'Sparsh Pearl'
  AND effective_date IN (DATE '2026-03-05', DATE '2026-08-20', DATE '2026-09-01')
GROUP BY effective_date, status
ORDER BY effective_date, status;
```

Afterward, the 20 August rows should have `status = 'discarded'` and
`batch_count = 2`; the 1 September approved batch remains unchanged. Confirm
the price-period query in `retime-sparsh-vol-62.md` still returns 150 rows at
5 March, no rows at 20 August, and 150 rows at 1 September.