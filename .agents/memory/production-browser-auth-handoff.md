---
name: Production browser authentication handoff
description: Safe real-session verification when the browser notebook lacks secret environment references
---

The testing browser notebook may lack secret environment references even though
the parent runtime can authenticate using existing secret references. A failed
development login does not establish that the production credentials fail.

**Why:** Production and development authentication records can differ. A real
production login succeeded while the notebook could not read its environment,
and a synthetic UI session could not establish production behaviour.

**How to apply:** Authenticate against the verified production URL using secret
references internally, without printing values. If necessary, hand only the
genuinely issued session to the notebook through an ephemeral non-repository
file with mode 0600; load it internally and verify the real auth endpoint reports
the required role. Never print tokens, use a content-printing file tool for the
handoff, or include it in reports/assets. Delete it after use. Do not mock auth,
forge sessions, change credentials or reset passwords to obtain verification.

Before declaring a source-selection UI blocked, try a normal available selection
and inspect the actual handler contract. A preferred dropdown option being
missing does not by itself prove the form cannot complete the requested flow.
For read-only production previews, verify the actual no-write branch before
allowing a POST; a button labelled Preview is not sufficient safety evidence.