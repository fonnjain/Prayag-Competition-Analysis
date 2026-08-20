---
name: CP observation preflight
description: The safe boundary for retiring the discontinuation correction manifest.
---

Widening the CP workbook observation set to every non-packing sheet must not by
itself replace the correction manifest. The complete-sheet preflight leaves
eight manifest-restored codes with removal-only observations:

- `6192-ON-OFF-N`
- `6193-ON-OFF-N`
- `BB-61`
- `DB-61-3IN-N`
- `DB-61-3IN-ON-OFF-N`
- `DB-61-H-N`
- `DB-61-H-ON-OFF-N`
- `DB-61-N`

The same preflight found no manifest-confirmed code that would be incorrectly
made live.

**Why:** The corrected input set still does not derive the required zero
re-marked restored codes, so removing the reassertion would regress the known
69/90 outcome.

**How to apply:** Keep the manifest reassertion in place. Before any future
replacement, identify the authoritative live/removed source evidence for these
eight codes, persist the per-batch observations, then rerun the manifest-free
69/90 dry run.