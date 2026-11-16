---
"keri-ts": patch
---

Fix browser wallets losing `gbls.aeid` on reload in Safari. WebKit's on-disk IndexedDB over-reads a binary element of
an array key that is not the last element, appending the next element's header and bytes, so the keeper's `aeid`
row was missed and setup failed with "Invalid registry root". The browser IndexedDB store is now format version 2:
rows have plain string keys and are read with unbounded `getAll()` calls, with no binary key parts, `IDBKeyRange` or
`getAllKeys` pairing. Upgrading deletes and recreates every existing browser keri-ts
IndexedDB store: restore the wallet or create it again. The `keyRange` option of `indexedDbOpener` and
`IndexedDbPersistence` is gone, and `Persistence.meta()` and `load(table)` are replaced by `Persistence.open()`. A blocked
open now rejects with a named error, and an abnormal connection close marks the adapter lost. `Manager` now fails
closed with `MissingDurableStateError` when the keeper has key material but no `gbls.aeid`, before it pins any
default, instead of writing defaults over the gap and failing later with "Invalid registry root". A new
`test:browser:persist` lane relaunches a persistent browser profile in WebKit and Chromium to check reloads from disk.
