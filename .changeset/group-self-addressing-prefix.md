---
"keri-ts": patch
---

Derive a self-addressing (Blake3-256) prefix for a group identifier even when it has
a single signing key, matching KERIpy's `GroupHab.make` (whose `code` defaults to
Blake3_256). Previously `makeGroupHab` let `incept` fall back to a basic prefix — the
member's public key — for a 1-of-1 group, which cannot rotate. This changes the derived
prefix of single-signing-key groups; a 1-of-1 group with the member's exact inception
parameters now shares the member's SAID, so distinct groups use a distinguishing
threshold or seal (as KERIpy does).
