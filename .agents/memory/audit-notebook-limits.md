---
name: Audit notebook limits
description: Avoid losing long audit sessions to the CodeExecution notebook memory cap.
---

Keep large audit pages and source responses in ignored output files, retaining
only bounded summaries in notebook variables. Release large response arrays
after saving them; notebook state persists across turns.

**Why:** Accumulated audit payloads exceeded the runtime's 32 MiB notebook limit.
The runtime reset every variable after the block, even though its completed
file-writing callbacks had already run.

**How to apply:** On a capture/reset error, check saved files and operation
receipts before retrying. A notebook reset is not a rollback of completed
callbacks and must never be treated as proof that a write did not happen.
