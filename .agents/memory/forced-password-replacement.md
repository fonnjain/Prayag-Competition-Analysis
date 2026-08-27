---
name: Forced password replacement
description: Password issuance policy for newly provisioned and reset workspace accounts.
---

New accounts that receive a password, and accounts whose password is reset by an administrator, must replace that credential before they can use protected workspace features. The replacement must differ from the temporary password.

**Why:** An administrator-issued password is a temporary bootstrap credential, not a password the recipient should continue using. Treating reset credentials the same way keeps the policy understandable and avoids leaving a known password active.

**How to apply:** Enforce this server-side for workspace and administrator routes, while leaving only authenticated password replacement available. Present the shared replacement screen in every web surface so a user can complete the required action without reaching ordinary app content. Existing users are not retroactively forced to change passwords.