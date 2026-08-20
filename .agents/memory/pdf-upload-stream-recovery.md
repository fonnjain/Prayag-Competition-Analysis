---
name: Long-running PDF upload recovery
description: Keep browser connections alive during slow PDF extraction and preserve a path to the completed staging batch if the stream drops.
---

PDF catalogue extraction must be treated as a durable server-side job, even though the current UI receives progress through one long-lived HTTP stream.

**Why:** Individual Claude vision chunks can run long enough for an otherwise healthy reverse proxy or browser connection to be considered idle. The server may finish staging successfully while the reviewer sees a generic network failure and unknowingly uploads the same catalogue again.

**How to apply:** Send periodic SSE heartbeat comments while an extraction is in flight, publish the newly created batch ID before slow work begins, and have the client retrieve that batch when its event stream closes unexpectedly. Do not require another file upload merely because the progress connection was interrupted.