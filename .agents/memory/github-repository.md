---
name: GitHub repository
description: The active GitHub destination for this Prayag project.
---

Use `fonnjain/Prayag-Competition-Analysis` as the project’s GitHub repository. The former `fonnjain/Prayag-Competition-Analysis-New` repository no longer exists and must not be selected for future pushes.

**Why:** The user confirmed on August 28, 2026 that the “-New” repository is no longer available.

GitHub `main` can diverge from Replit’s local `main` even when the remote-only patch is already present byte-for-byte in the local tree. Reconcile that case with a normal merge and verify the merge preserves the local tree hash; never force-push over the remote history.

**Why:** A provenance commit was pushed independently to GitHub while Replit continued on a separate history. A history-only merge preserved both lines without changing the completed application tree.

**How to apply:** When multiple GitHub remotes appear, select the remote pointing to `fonnjain/Prayag-Competition-Analysis`. If push is rejected as non-fast-forward, fetch, inspect the remote-only patch, merge normally, and confirm the resulting tree before pushing.