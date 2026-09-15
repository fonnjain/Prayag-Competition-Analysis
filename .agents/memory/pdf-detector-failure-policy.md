---
name: PDF detector failure policy
description: Safety rule for distinguishing unavailable text extraction from evidence supporting vision extraction.
---

If every sampled PDF page returns zero characters, report text extraction as unavailable and do not classify the document or recommend AI vision.

**Why:** A missing or failing text extractor can otherwise make a text-native catalogue look image-only and silently route it through the wrong extraction path. A genuine image-only PDF and a broken extractor are indistinguishable from all-zero output alone, so the conservative result must block extraction.

**How to apply:** Preserve subprocess failures instead of converting them into empty page text. Enforce the same guard in read-only preflight and again immediately before extraction begins.