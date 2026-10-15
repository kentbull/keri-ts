---
"keri-ts": minor
"@keri-ts/tufa": minor
---

Remove query-request byte reservations, preparation floors, metadata quotas and synthetic busy/refused admission. RuntimeDeliveries accepts concrete query records directly; signing and endpoint selection precede source removal, while failed transport and cancellation retain their existing retry and cleanup behavior.
