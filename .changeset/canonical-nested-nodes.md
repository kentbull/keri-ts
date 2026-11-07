---
"cesr-ts": patch
"keri-ts": patch
---

Serialize a nested node without evidence as its body alone and drop zero-count semantic groups on hydration, so legacy `-KAA` and `-C(-KAA)` placeholder nodes re-serialize to KERIpy's canonical bytes. Every v2 attachment path now writes sequence and first-seen ordinals as compact Numbers, matching KERIpy `messagize`; v1 keeps the fixed Seqner.
