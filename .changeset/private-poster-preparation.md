---
"keri-ts": major
---

Remove Poster.resolveBytesRoute and make route selection and target preparation
private. Tests and callers use queued message admission and accepted endpoint state;
route snapshots and prepared-target types are no longer exported contracts.
