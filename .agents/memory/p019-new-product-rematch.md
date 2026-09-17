---
name: P019 new-product rematch boundary
description: Why the New Products workflow performs only seven explicit Prince staging rematches and must not generalize them.
---

The P019 New Products apply may rematch only the seven explicitly approved Prince-to-Prayag pairs. It changes eligible import staging and audit state only; it must not rewrite live competitor prices, rematch other competitors, or infer additional pairs.

**Why:** The rejected Prince rows had no persisted Prayag codes, and the trusted locked matching workbook was not independently stored as a general matching source. The seven approved pairs are therefore a narrow business exception rather than evidence for a broader matcher.

**How to apply:** Keep future generic matching improvements separate from P019. Any expansion of this allowlist requires new verified source evidence and explicit approval, while Sparsh, Ashirvad, and live competitor-price rows remain outside this workflow.