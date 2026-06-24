---
name: Orval zod coerce.boolean trap
description: Generated query-param schemas mis-coerce boolean flags
---
Orval generates `z.coerce.boolean()` for boolean OpenAPI query params. `Boolean("false")` is `true`, so `?flag=false` wrongly enables the filter.

**Why:** JS Boolean coercion treats any non-empty string as truthy; Zod's coerce just wraps `Boolean()`.

**How to apply:** For boolean query flags, ignore the coerced value and read `req.query["flag"] === "true"` explicitly in the route. Affects any new boolean query param added to the OpenAPI spec.
