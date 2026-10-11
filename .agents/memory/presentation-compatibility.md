---
name: Presentation compatibility
description: Verifying that delivered PPTX packages really open and their screenshots are rendered.
---

Use a standard presentation serializer for PPTX packaging. Do not accept successful ZIP extraction, XML parsing, or a Python reader alone as proof that an office viewer can open a deck.

**Why:** Manually assembled packages passed those checks but an office viewer refused all of them. Rebuilding their packages through a standard library resolved the opening failure.

**How to apply:** Open and render every delivered deck with an available office viewer. Check the rendered page counts and image-bearing pages against the requested slides. Preserve the user's plain/default layout requirements.

For live screenshot documentation, await completed data requests and disappearance of skeletons before capture. Scroll the relevant table or panel into view so a loaded header is not mistaken for evidence that its data is visible.

**Why:** Captures made immediately after navigation or comparison submission showed loading placeholders; completed tables could also sit below the captured viewport.

**How to apply:** Review screenshot contact sheets and representative office-rendered slides. Respect read-only constraints: label genuinely unavailable conditional states instead of creating data to force them.
