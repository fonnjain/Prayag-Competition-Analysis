---
name: Activity tracking accounting
description: Durable rules for reliable user activity rollups and report access.
---

Time-bearing events must first charge the elapsed interval to the session's
previous state, then change that state. Page views and action events record
engagement but must not advance the heartbeat cursor.

**Why:** Advancing the cursor for a non-time event loses the time before the
next heartbeat, while applying a new state before the interval is charged
misattributes active and idle time.

**How to apply:** When adding activity event types, explicitly decide whether
they carry elapsed time. Only heartbeats, state transitions, and session end
events update the timing anchor. Maintain daily totals per session as well as
per user so a selected-day drill-down never displays a session's lifetime
duration.

Activity app identity is untrusted client input and must be validated against a
known list and the authenticated role's allowed apps.

**Why:** Counter accounts may use Price Finder but must not be able to fabricate
activity for workspace-only applications.

**How to apply:** Keep telemetry access authenticated and enforce app
permissions server-side before storing events; administrative reports remain
admin-only.

Activity receipt time, not the browser's clock, is authoritative for report
dates and duration calculations. Enforce per-user, local-day quotas while
holding a user/day transaction lock.

**Why:** Client timestamps and concurrent requests otherwise let a user
backdate, future-date, or race arbitrary report totals.

**How to apply:** Store the server receipt timestamp for accepted events.
Serialize session, page-view, and action quota checks by user and
workspace-local date; retain per-session locking for duration rollups. Keep
the limits generous enough for normal multi-tab use while bounding all
client-originated totals.