---
name: MRP source provenance
description: Rules for recording official source snapshots behind Prayag MRP history.
---

Every MRP-sheet upload must name a source from the six-source register, provide the human-supplied download date, and receive a server-computed SHA-256 before history rows are accepted. Byte-identical reloads require explicit confirmation; a changed cell is a distinct snapshot even if its filename is unchanged.

**Why:** A filename and filesystem modified time do not establish which source snapshot produced a price. The checksum and supplied export date let reviewers distinguish a known historical copy from the current live Google Sheet.

**How to apply:** Keep each historical price row linked to a load batch. For retrospective records, map by the embedded original workbook filename in `source_file`. The September 2026 PTMT snapshot's complete SHA-256 is now verified and stored; do not regress it to an abbreviated digest.

When a canonical division sheet is demonstrably older than a later Prayag-returned authoritative master, do not relabel a fresh download of the old sheet as current evidence. Register the verified authoritative slice as that division's replacement batch and relink only the period it replaces.

**Why:** A newly downloaded stale workbook has a recent download date but still does not support the newer prices. Treating its timestamp as freshness would make provenance health actively misleading.

**How to apply:** Verify the authoritative file hash and the division slice's expected row/revision/addition counts, preserve prior-period batch links, and record a separate replacement event for each relinked row.

Manual corrections are not official workbook loads: require a reviewer-supplied reason and record each action in a dedicated internal manual batch. Keep that source out of the six official-source health rows.

**Why:** Reusing an official batch after overwriting its price makes it falsely appear that the workbook contained the correction. A separate manual event preserves both the source record and the reviewer’s accountability.

**How to apply:** A same-date manual correction can replace the visible history row because the database permits one row per code and effective date, but it must move that row to the new manual batch and retain the reason. Official batch row counts remain historical facts; show their current linked-row divergence in Data Health instead of rewriting them.

Authoritative masters are identified by verified content, not by filename or extension, and may be applied only once. Retried or concurrent uploads must be no-ops. Preserve source item codes apart from trimming and case normalization.

**Why:** Replaying a multi-period master would rewrite provenance, while collapsing meaningful internal spaces could merge distinct signed rows.

**How to apply:** Route every upload matching the authoritative content identity through the protected load path; ordinary duplicate confirmation must never override it.

Production provenance backfills must run only through a published, administrator-gated endpoint after read-only before/after fingerprints are captured. The receipt must distinguish a normalized payload checksum from an original workbook checksum and prove unaffected batches retain their counts and digests.

**Why:** A retrospective linkage is safe only when it changes provenance metadata, not prices or historical membership. A database-side shortcut would bypass the release and audit controls that establish who confirmed the operation.

**How to apply:** Publish first, authenticate as an administrator, use the exact confirmation phrase, then verify the attached-row count, payload hash, source notes, zero remaining gap, and unchanged neighboring-period fingerprints.
