---
"keri-ts": patch
---

Advance local mailbox cursors only after successful batch consumption so failed or cancelled batches remain available when polling restarts on the same instance.
