---
"keri-ts": patch
---

Recover explicitly selected multisig evidence accepted before interrupted handler indexing. Apply group selection first, replay the original authenticated wrapper through normal protocol intake, and let Multiplexor rebuild its own indexes before approval. Recorded local approvals reuse their original signatures and recipient wrapper; fresh peer proposals still require approval. No direct index repair, background recovery queue or new persistence is added.
