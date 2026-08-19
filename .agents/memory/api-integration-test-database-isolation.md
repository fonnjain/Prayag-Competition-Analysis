---
name: API integration test database isolation
description: Reliable validation of API integration tests that share the development PostgreSQL database.
---

Run the API integration suite serially while tests share the same PostgreSQL database and clean up related history tables.

**Why:** Parallel Vitest workers can acquire conflicting locks during teardown, causing a PostgreSQL deadlock even when every test assertion has passed.

**How to apply:** Use a single worker for full API validation until the tests have isolated databases or cleanup that cannot contend. Treat a parallel cleanup deadlock as test-runner infrastructure debt, not evidence that an unrelated route regression exists.