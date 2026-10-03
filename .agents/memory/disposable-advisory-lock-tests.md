---
name: Disposable SQL suites and advisory locks
description: Why transaction tests in different private schemas can still interfere
---

**Rule:** Run SQL suites that exercise the same application advisory locks
serially, even when each suite has its own disposable schema and sequences.

**Why:** PostgreSQL advisory locks are database-wide, not schema-local.
Parallel master-loader transaction tests can make a separate Range suite wait
past its test timeout; the blocked query then overlaps teardown or later tests.
This does not indicate a public-data mutation or a catalogue classification bug.

**How to apply:** Disable file parallelism for a combined run of these suites.
Keep private tables and sequences as the separate data-isolation boundary.
Do not weaken production locks or increase timeout alone to hide contention.