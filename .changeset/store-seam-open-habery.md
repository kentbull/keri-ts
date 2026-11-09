---
"keri-ts": patch
---

Add backend-neutral `openHabery`, which requires a `StoreOpener` or borrowed stores. `createHabery` keeps its LMDB-default behavior and signature in a separate module.
