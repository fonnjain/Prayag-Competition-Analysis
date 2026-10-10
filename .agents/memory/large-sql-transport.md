---
name: Large SQL transport
description: Avoid argument-size failures when sending large approved development load payloads.
---

Large inline SQL sent through executeSql can fail with `spawn E2BIG` before the database command runs. Do not split one approved atomic batch into independently committed fragments to bypass this.

**Why:** An approved multi-brand workbook payload exceeded the callback's process-argument transport limit, despite fitting the notebook file budget.

**How to apply:** For large authorized development mutations, read the payload inside a PostgreSQL client process rather than putting it in a shell argument. Assert the development database identity with the existing fail-closed guard before mutation, use an atomic transaction, bind values where practical, and verify protected rows and counts. This is not permission to access production or expose connection credentials.
