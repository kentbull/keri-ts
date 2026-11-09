---
"keri-ts": minor
---

Add the backend-neutral `DBer` store contract and opaque `Table` handle from ADR-0015. `Suber` and `Komer` families now take a `DBer` and hold a `Table`, so `sdb` is no longer typed as an lmdb-js database; LMDB-specific code reaches the native handle through `lmdbTable()`. Storage behavior is unchanged.
