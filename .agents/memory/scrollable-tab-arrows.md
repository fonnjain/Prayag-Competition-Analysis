---
name: Scrollable tab arrow stability
description: Why horizontal tab controls must not change the scroll viewport width during an animated scroll.
---

Keep left and right arrow slots mounted at a stable width around horizontally scrollable tab rows. Disable and visually hide unavailable arrows instead of conditionally inserting or removing them.

**Why:** An arrow that appears as soon as scrolling starts changes the scroll container's position or width during the smooth animation. Even when the target is calculated at a tab boundary, that layout shift can leave the first visible tab clipped.

**How to apply:** For any horizontal tabs, pills, or carousels with external arrow controls, reserve both control slots for the lifetime of the row. Toggle visibility and pointer interaction without changing layout geometry.