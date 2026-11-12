---
"keri-ts": minor
---

Add the `keri-ts/db/indexeddb` entrypoint, exporting `IndexedDbPersistence` and `indexedDbOpener` so browser compositions can persist `WebDBer` stores to IndexedDB. It stays off `keri-ts/db` so Node consumers do not type-check DOM types.
