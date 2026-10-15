---
"cesr-ts": minor
"keri-ts": minor
"@keri-ts/tufa": minor
---

Remove codec allocation estimates, decoded-body budgets, capacity callbacks and
speculative CBOR extension refusals. Preserve exact body ownership, native codec
semantics, malformed-wire provenance and actual CBOR decoder-state cleanup.
