---
name: Production catalogue safety acceptance
description: User-required production seed/reset prohibition and strict read-only verification boundaries
---

Production catalogue seed/reset must not be runnable through normal application
paths, even with an administrator session.

**Why:** The user's production acceptance check explicitly requires this
prohibition. Admin permission and a spelling-preview fingerprint are not an
environment-level prohibition.

**How to apply:** Check both the reset route and internal seeding entrypoint,
including empty-catalogue startup. Do not invoke a destructive operation to
demonstrate that it is blocked. Any implementation is a separate authorized
change, not part of a read-only confirmation.

Read-only production confirmation must distinguish genuine live admin previews
from offline replay or UI fixtures. Inspect whether Preview persists staging or
approval records before issuing it.

**Why:** The user forbids Apply, Save, Create, reset and merge during confirmation;
a Preview label alone does not establish a no-write handler.

**How to apply:** Keep unavailable authentication or unsafe preview paths
explicitly blocked. An unchanged catalogue snapshot proves data preservation,
not successful execution of a live authenticated preview.