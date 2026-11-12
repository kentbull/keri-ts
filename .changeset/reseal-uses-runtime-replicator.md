---
"keri-ts": patch
---

`kli multisig rotate` and `join` re-seal held registry roots through the runtime's own root replicator instead of building a second one inside the command.
