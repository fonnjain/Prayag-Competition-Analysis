---
name: Production catalogue safety acceptance
description: User-required production seed/reset prohibition and strict read-only verification boundaries
---

Production catalogue seed/reset must not be runnable through normal application
paths, even with an administrator session.

The scope includes reset, automatic catalogue seeding and full-catalogue sync.
Keep targeted product deletion/retirement, single-price and period corrections,
normal loaders and all undo paths available in production. Other broad-scope
operations discovered during an audit are candidates to report, not permission
to disable additional workflows.

**Why:** The user explicitly wants mistake-correction workflows preserved;
blocking them pushes operators toward direct database edits.

**How to apply:** Scope guards to whole-catalogue replacement entrypoints. Audit
other endpoints' permissions and affected rows without altering those permissions.

If a team data-promotion workflow needs a replacement for signed dev-to-production
catalogue sync, review a separate scoped route rather than re-enable wholesale
production replacement. Do not equate absence from deployment scripts with proof
that no manual or external team workflow depends on it.

**Why:** The user requires release/deployment and team-workflow dependency checks
before publishing this restriction, and explicitly prefers a reviewed replacement
route if promotion is still needed.

**How to apply:** Report automated dependencies separately from historical/manual
use. Obtain confirmation of current team reliance before treating the transfer
path as retired; any replacement needs separate review.

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