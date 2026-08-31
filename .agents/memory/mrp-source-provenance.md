---
name: MRP source provenance
description: Rules for recording official source snapshots behind Prayag MRP history.
---

Every MRP-sheet upload must name a source from the six-source register, provide the human-supplied download date, and receive a server-computed SHA-256 before history rows are accepted. Byte-identical reloads require explicit confirmation; a changed cell is a distinct snapshot even if its filename is unchanged.

**Why:** A filename and filesystem modified time do not establish which source snapshot produced a price. The checksum and supplied export date let reviewers distinguish a known historical copy from the current live Google Sheet.

**How to apply:** Keep each historical price row linked to a load batch. For retrospective records, map by the embedded original workbook filename in `source_file`. The September 2026 PTMT snapshot's complete SHA-256 is now verified and stored; do not regress it to an abbreviated digest.

Manual corrections are not official workbook loads: require a reviewer-supplied reason and record each action in a dedicated internal manual batch. Keep that source out of the six official-source health rows.

**Why:** Reusing an official batch after overwriting its price makes it falsely appear that the workbook contained the correction. A separate manual event preserves both the source record and the reviewer’s accountability.

**How to apply:** A same-date manual correction can replace the visible history row because the database permits one row per code and effective date, but it must move that row to the new manual batch and retain the reason. Official batch row counts remain historical facts; show their current linked-row divergence in Data Health instead of rewriting them.

Pinned multi-division authoritative masters are an exception to ordinary duplicate confirmation: identify them by their exact SHA-256 and immutable sheet contract, serialize the load, and never permit a forced duplicate batch. Preserve source item codes exactly apart from trimming/case normalization; internal spaces can distinguish signed rows already present in the catalog.

**Why:** An authoritative master replaces several source periods and the full withdrawal set at once. Replaying it would rewrite provenance, while collapsing internal spaces would merge distinct signed workbook rows and make the withdrawal count disagree with the source.

**How to apply:** Create the provenance source, check for the existing hash, write catalog/history/withdrawal data, and recompute current flags inside one transaction. A concurrent retry must return the original batch without mutations.