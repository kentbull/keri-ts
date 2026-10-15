---
"keri-ts": minor
---

Require route-specific query instructions through cues, pending requests and Hab signing, with one authoritative target. Hab.query now accepts an instruction object instead of separate arbitrary body and route arguments.

Keep unresolved schema and credential recovery notices notify-only instead of falling back to KEL queries, and emit canonical sequence filters without redundant route or digest hints.
