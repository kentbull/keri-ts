---
"keri-ts": minor
"@keri-ts/wallet": patch
"@keri-ts/verifier": patch
"@keri-ts/observer": patch
"@keri-ts/registrar": patch
"@keri-ts/hosting": patch
"@keri-ts/tufa": patch
---

Make `keri-ts/db` and `keri-ts/runtime` backend-neutral and move the native LMDB surface to `keri-ts/db/lmdb`. This breaks imports of `LMDBer`, `createHabery`, the `create*` store factories and `openRegistry`'s LMDB default from their old entrypoints; import them from `keri-ts/db/lmdb` (`openLmdbRegistry` replaces the default).
