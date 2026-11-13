---
"keri-ts": patch
---

A DH query that arrives after a restart is checked against the persisted held query exactly as before one: a re-dated successor with the same Grant, transaction and keys replaces it, and one with different keys is refused as conflicting.
