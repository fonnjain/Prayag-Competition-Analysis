---
name: Workbook content identity
description: Durable rules for gating trusted spreadsheet imports after harmless XLSX re-saves.
---

Authorize trusted spreadsheet loads using a canonical content fingerprint built from normalized business values, not the XLSX byte hash. Record both identities in provenance: the content fingerprint decides whether parsing may proceed, while the byte SHA-256 identifies the exact file received.

**Why:** XLSX files are ZIP containers whose timestamps and compression order change when re-saved even when every cell value is identical. Byte-hash authorization rejects valid files and encourages operators to bypass the safety gate.

**How to apply:** Define the canonical row projection, normalization, numeric formatting, sort order, delimiter, encoding, expected row count, and expected aggregate alongside each trusted loader. Fail closed for damaged or extended source structures, preview before Apply, and make same-fingerprint retries idempotent.