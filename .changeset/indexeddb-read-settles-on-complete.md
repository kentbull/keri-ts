---
"keri-ts": patch
---

`IndexedDbPersistence.meta` and `load` now resolve when their read transaction completes, not when the last request succeeds. WebKit reported a `blocked` delete, and `clear` rejected, when a store was cleared right after a read.
