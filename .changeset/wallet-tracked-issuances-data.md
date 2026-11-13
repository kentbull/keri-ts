---
"@keri-ts/wallet": patch
---

The wallet now tracks an issuance in flight as plain data (the identifier, the credential and its registry) instead of
a stored function. One function, `recordFinished`, records it in the inventory from that record when the change sink
sees the issuance finish or a registry root arrive, and the single-signature path, the group path and
`credentials.rebuild()` share one recording step. The unused `IssuanceRecorder` type is no longer exported.
