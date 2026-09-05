---
"keri-ts": patch
---

Add opt-in durable remote mailbox admission for managed SDK consumers. Store exact inbound bytes and source cursors atomically, replay retained batches after reopen, and require explicit durable disposition rather than interpreting parser return as application completion. Preserve legacy polling as the default and bound retained data with fail-closed capacity limits.
