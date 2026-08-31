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

## Production reconciliation receipt

The release containing the protected reconciliation endpoint and Product
Database Data Health action was published before the operation. On 31 August
2026, an authenticated administrator invoked the deployed endpoint with the
required confirmation phrase. It returned HTTP 200 with:

- `alreadyReconciled = false`
- `attachedRows = 148`
- `distinctCodes = 121`
- `loadBatchId = 16`
- normalized payload SHA-256
  `afc3d0dac14122ade160b11b5ed9418160ac9ec54de606c88efabd339973e8b7`

Batch 16 is linked to known source 465, “Ceramic Sanitaryware colour variants,”
and records 148 declared and linked rows across 121 item codes. Its payload size
is 11,965 bytes and its required `downloaded_at` value is 2026-08-19. The batch
notes explicitly state that the checksum identifies the checked-in normalized
2026-01-15 period payload, not the original XLSX bytes, and that the original
XLSX download date was not retained.

The reconciliation's exact-manifest guard accepted identity MD5
`70c6e1a55bfd0c294bf79284367c00cf`; the same digest was returned by the
post-operation production query. This confirms that the January prices and
history values were unchanged while their missing batch links were attached.

### Post-operation invariants

- The January known-source gap is zero.
- Data Health shows `Known-source colour rows reconciled (148)` and no longer
  shows the January reconciliation action or its `Attach 148 rows` button.
- Authoritative batch 15 remains unchanged at 6,226 declared and linked rows,
  including all 150 May colour rows. Its linked-history fingerprint was
  `d39a1a30fdfb7148e7c193b8b01f8bd9` both before and after the operation.
- The complete May colour set remains unchanged at 150 rows across 123 item
  codes, all linked to batch 15. Its row fingerprint was
  `cfa5573ba5a243bd1ac5df0e171a943d` both before and after the operation.
- Batch 15 retains its original authoritative-workbook SHA-256
  `a6cd9c4d82ab60a1b77644edba5446af90bf9df25174095e791b6c23f773cab2`,
  separately from batch 16's normalized January payload checksum.