---
"keri-ts": patch
---

Compose `Baser` and `Keeper` over an injected `DBer`. `createBaser` and `createKeeper` keep their signatures and paths; direct construction now takes a store or uses `lmdbBaser` and `lmdbKeeper`.
