---
"keri-ts": patch
---

Bound a pending v2 Grant's partial-signature escrow cleanup by its accepted KRAM transaction lifetime once sender threshold intake succeeds, instead of keeping the local timeout frozen from the first partial contribution. Group issuance no longer loses its approved Grant ten seconds after the first member signature.
