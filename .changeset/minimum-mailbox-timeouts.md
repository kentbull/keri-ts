---
"keri-ts": patch
---

Clamp positive mailbox polling timeout overrides to at least one millisecond so fractional values cannot create an immediate header deadline or an invalid SSE window.
