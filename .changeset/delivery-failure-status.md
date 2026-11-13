---
"keri-ts": patch
---

A delivery an operation is retrying now reports why it failed. Active issuance, presentation and Unblind statuses carry `failure` (`attempts`, `reason` with the error's `cause` chain flattened, and `retryAt`), and `DeliveryOutbox` exposes it. Presentation status drops its `attempts` and `blocked` fields in favour of `failure`.
