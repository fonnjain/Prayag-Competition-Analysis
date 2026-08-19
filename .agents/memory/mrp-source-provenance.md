---
name: MRP source provenance
description: Rules for recording official source snapshots behind Prayag MRP history.
---

Every MRP-sheet upload must name a source from the six-source register, provide the human-supplied download date, and receive a server-computed SHA-256 before history rows are accepted. Byte-identical reloads require explicit confirmation; a changed cell is a distinct snapshot even if its filename is unchanged.

**Why:** A filename and filesystem modified time do not establish which source snapshot produced a price. The checksum and supplied export date let reviewers distinguish a known historical copy from the current live Google Sheet.

**How to apply:** Keep each historical price row linked to a load batch. For retrospective records, map by the embedded original workbook filename in `source_file`. Do not fabricate an unavailable full digest: the September 2026 PTMT snapshot currently has only its verified SHA-256 prefix, which must remain documented as incomplete until the original file is supplied.