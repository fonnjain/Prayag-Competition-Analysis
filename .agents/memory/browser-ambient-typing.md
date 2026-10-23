---
name: Browser ambient typing
description: Missing DOM libraries can produce misleading animation and inference errors.
---

Restore the correct browser ambient libraries before adding casts to repair
Framer Motion `Variant` errors in a browser artifact.

**Why:** A DOM-less TypeScript configuration produced missing browser APIs,
implicit-any callbacks and transition/Variant incompatibilities together.
Adding the actual browser libraries resolved all of them; animation assertions
were unnecessary. A secondary type error was not an independent runtime defect.

**How to apply:** Inspect the artifact's compiler environment first, compare a
working browser artifact, and preserve strictness and workspace package coverage.
Keep a type-only correction separate from feature or content changes.
