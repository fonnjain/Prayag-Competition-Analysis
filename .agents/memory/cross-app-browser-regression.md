---
name: Cross-app browser regression setup
description: Constraints for running browser checks across Prayag’s path-routed web artifacts.
---

Use Chromium explicitly for both desktop and narrow-mobile Playwright projects; device presets such as iPhone 13 otherwise select WebKit, which is not installed in this workspace.

**Why:** The app-switching checks exercise four independently served artifacts through the shared path proxy, and the Replit Nix runtime does not include browser libraries by default.

**How to apply:** Start the four web artifact workflows before running the suite, use the shared proxy base URL, and keep the Chromium libraries declared in `.replit` so a clean workspace can launch the checked-in browser suite.

Actual browser-zoom checks need full Chromium, not the default headless shell.
Use an ephemeral local extension and `chrome.tabs.setZoom`, verify the returned
zoom and `devicePixelRatio`, and remove the extension/profile afterwards.

**Why:** A smaller CSS viewport is useful layout coverage but does not prove real
browser zoom. Full Chromium also needs CUPS/Cairo/Pango libraries; mixing their
Nix generations can load HarfBuzz against an older FreeType and fail at startup.

**How to apply:** Resolve installed library paths rather than installing another
browser. Prepend a compatible modern FreeType with the extra libraries for this
temporary process; do not change app dependencies or permanent secrets.

For read-only screenshot documentation, check for the installed Nix-aware
Chromium wrapper before changing any dependencies. Downloadable presentations
need real image files, not browser-observation identifiers. Wait for protected
page content to render; an authentication loading frame is not a page capture.

**Why:** Browser observation images were not exportable as presentation assets,
and the raw cached Chromium lacked libraries that the installed wrapper supplied.
Cold page loads also briefly showed only the authentication loading state.

**How to apply:** Verify `/repl/tools/bin/chromium` exists and launches before
using it as a Playwright executable. Use a genuine, approved session, restrict
business writes, remove branding only in the capture, and revoke the temporary
session after exporting. For bulk ImageMagick processing, limit threads per
process; the default thread count can make otherwise small image jobs very slow.