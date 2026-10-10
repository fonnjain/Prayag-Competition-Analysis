---
name: Competitor workbook operating policy
description: Business requirements for general workbook imports and production reversals.
---

Competitor workbooks carrying multiple brands and multiple dated periods are a
normal operating case, not a file-specific exception.

**Why:** Prayag explicitly confirmed that this is how future workbooks will arrive.

**How to apply:** Preserve each brand's own dated columns and source units. Do not
turn the workflow into a single-brand loader with one caller-supplied date.

Production competitor imports and reversals must go through the admin application.
Do not offer hand-run SQL or a standalone undo script as a substitute, even if it
could write an audit record.

**Why:** The user requires provenance, batch history and a shared undo action
available to any administrator; earlier provenance reconciliation established the
importance of keeping these operations inside the app.

**How to apply:** Build and verify the application path in development first.
Production loads need explicit approval and the published guarded path. Use
read-only SQL for independent verification, not as a production write fallback.
