---
"keri-ts": patch
---

Derive a self-addressing (Blake3-256) prefix for a group identifier even when it has a
single signing key, matching KERIpy's `GroupHab.make` (whose `code` defaults to
Blake3_256). Previously `makeGroupHab` left `incept` to choose a basic, key-derived
prefix for a 1-of-1 group. This is a prefix-derivation parity fix: it changes the
derived prefix of single-signing-key groups, so a 1-of-1 group with the member's exact
inception parameters now shares the member's SAID (as in KERIpy), and distinct groups
use a distinguishing threshold or seal.
