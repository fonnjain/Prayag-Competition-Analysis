# MRP history value checksum (P049)

This is the **value-only audit definition**, not a file checksum, catalog-sync
bundle checksum, or the whole-row MD5 snapshot used by `importBatches.ts` in this
directory. It is recorded beside that existing snapshot calculation so a future
change does not accidentally conflate the definitions. No application code
currently writes or stores this new checksum.

## Exact definition

- Input table: every row of `public.mrp_price_history`, including non-current
  rows and every variant. No joins, filters, deduplication, or price rounding.
  Repeated identical value rows appear repeatedly. Report the row count with
  the checksum.
- Ordered fields in each row: `item_code`, `effective_date`, `variant`, `mrp`,
  `net_price`, `discount_pct`, `price_basis`. Use the stored values exactly:
  no trimming, case folding, default variant substitution, or inferred prices.
- Text rendering: use PostgreSQL `jsonb_build_array(... )::text` with those
  seven fields in that order. JSON array commas are the **field separators**;
  JSONB supplies its standard JSON string escaping and represents SQL NULL as
  JSON `null`. Render a non-null date with
  `to_char(effective_date, 'YYYY-MM-DD')`; a null date remains null. For each
  of the three `double precision` price-related fields, render the **exact
  stored IEEE-754 bits** as 16 lowercase hexadecimal digits in network byte
  order using `encode(float8send(value), 'hex')`. A null float stays JSON
  `null`. Thus there is **no decimal rounding, fixed decimal-place rule, or
  trailing-zero formatting**; `1.00` and `1.0` are the same stored floating
  value, while genuinely different stored bits remain distinguishable.
- Sort the resulting complete row strings by PostgreSQL bytewise
  `COLLATE "C"` ascending. Do not sort by database ID or by locale-dependent
  field comparisons. Identical row strings repeat in the concatenation.
- Join rows with exactly one LF (U+000A, SQL `E'\n'`). There is **no leading
  or trailing newline**. Zero rows produce the empty string.
- Encode the joined string as UTF-8; calculate SHA-256 of those bytes and
  present its 64 lowercase hexadecimal digits. The digest covers **values,
  not provenance**: exclude `id`, `load_batch_id`, `import_batch_id`, source
  fields, notes, creation/update times, review/audit fields, and `is_current`.
  In particular, a provenance-only backfill attaching `load_batch_id` must
  not change this digest.

Run this exact read-only query independently against each environment:

```sql
SELECT count(*) AS rows,
       encode(
         sha256(
           convert_to(
             coalesce(string_agg(row_text, E'\n'
                                 ORDER BY row_text COLLATE "C"), ''),
             'UTF8'
           )
         ),
         'hex'
       ) AS value_sha256
FROM (
  SELECT jsonb_build_array(
           item_code,
           to_char(effective_date, 'YYYY-MM-DD'),
           variant,
           encode(float8send(mrp), 'hex'),
           encode(float8send(net_price), 'hex'),
           encode(float8send(discount_pct), 'hex'),
           price_basis
         )::text AS row_text
  FROM public.mrp_price_history
) AS value_rows;
```

**Worked environment pair, 2026-09-25 IST:** development at 15:32:03 had
14,012 rows and value SHA-256
`4d3e971cc8d88750583741d995c51013a3c690c6a1537127cbee62f21d3401f2`;
production at 15:32:10 had 14,252 rows and value SHA-256
`e09c0fad6b028284a8f15026801ff30993972fcf97387dc105b0b40510fb865d`.
The differing digests do not by themselves imply corruption: the row counts
and environments differ. These are not replacements for any previously stored
or reported MD5 or differently defined SHA-256 checksums.