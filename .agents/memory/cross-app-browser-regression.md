---
name: Cross-app browser regression setup
description: Constraints for running browser checks across Prayag’s path-routed web artifacts.
---

Use Chromium explicitly for both desktop and narrow-mobile Playwright projects; device presets such as iPhone 13 otherwise select WebKit, which is not installed in this workspace.

**Why:** The app-switching checks exercise four independently served artifacts through the shared path proxy, and the Replit Nix runtime does not include browser libraries by default.

**How to apply:** Start the four web artifact workflows before running the suite, use the shared proxy base URL, and keep the Chromium libraries declared in `.replit` so a clean workspace can launch the checked-in browser suite.