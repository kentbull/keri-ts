---
"keri-ts": patch
---

Reject new direct mailbox streams after their owning director has closed. Remove
provider stream reservations and message/topic/metadata quotas while preserving
demand-driven output, query correlation, exact cursors and joined reader cleanup.
