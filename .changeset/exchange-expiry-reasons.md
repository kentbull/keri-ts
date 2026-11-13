---
"keri-ts": patch
---

Say why an expired exchange is gone. `Exchanger.exchangeExpiry(said)` answers an exchange's KRAM deadline after its
cache row is pruned and after an expired pending exchange is ejected from escrow. Past the deadline,
`issuanceStatus`, `approveIssuanceExchange`, `beginIssuance` and `receiveIssuance` throw `KramRefusedError` (reason
`lifetime`, with the deadline) instead of a generic not-found, the `expired` issuance status carries `deadline`, and
`pendingApplies` no longer lists an expired Apply again once KRAM prunes its record.
