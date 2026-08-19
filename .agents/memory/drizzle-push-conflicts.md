---
name: Non-interactive Drizzle push conflicts
description: How to handle an additive development schema change when Drizzle stops at an unrelated interactive conflict.
---

After a merged additive database change, verify the expected development table
actually exists. If `drizzle-kit push` stops because a rename/conflict prompt
requires a TTY, do not use a force option that could accept unrelated schema
changes. Apply only the reviewed static additive DDL in development, then let
Replit Publish carry the development schema diff to production.

**Why:** An additive audit table and an earlier provenance table were present in
the Drizzle schema but absent from development because the normal push stopped
at an unrelated interactive prompt. Forcing the full diff would have risked
unintended changes.

**How to apply:** After schema merges, check the expected table/indexes directly.
Use targeted `CREATE TABLE/INDEX IF NOT EXISTS` only when the change is purely
additive and fully reviewed; never create custom production migration scripts.