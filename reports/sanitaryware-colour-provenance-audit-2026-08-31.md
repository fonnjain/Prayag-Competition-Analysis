# Sanitaryware colour provenance audit

## Production findings

- No load batch is currently named `Prayag_Sanitaryware_Variant_Prices.xlsx`.
- The 150 unique colour rows effective 2026-05-01 are linked to authoritative batch 15.
- Batch 15 has SHA-256 `a6cd9c4d82ab60a1b77644edba5446af90bf9df25174095e791b6c23f773cab2` and a declared row count of 6,226.
- The 148 unique colour rows effective 2026-01-15 retain `source_file = Prayag_Sanitaryware_Variant_Prices.xlsx`, `load_date = 2026-08-19`, and no load batch.
- Their normalized January period payload is 11,965 bytes with SHA-256 `afc3d0dac14122ade160b11b5ed9418160ac9ec54de606c88efabd339973e8b7`. This is deliberately recorded as a payload checksum, not an original-workbook checksum.

## Why the periods diverged

The checked-in source has 300 entries: 149 January entries and 151 May
entries. Item `4663`, variant `Ivory`, occurs twice in each period. The database
uniqueness key therefore reduces the source to 148 January rows and 150 May
rows, or 298 unique rows total.

The original seed inserted those rows without load-batch provenance. A later
provenance-aware startup seed returned immediately when it found any existing
non-Standard row, so it did not retrofit either period. The authoritative
master loaded on 31 August included the May colour rows and upserted their
source and batch to batch 15. It did not include the January colour period, so
those 148 rows remained unbatched.

This is an incomplete known-source reconciliation, not unknown-origin history.
The recurrence guard must audit all 298 unique source keys across both periods
instead of treating “any variant row exists” as proof that seeding and
provenance are complete.