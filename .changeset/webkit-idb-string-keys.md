---
"keri-ts": patch
---

Fix keeper state lost on reload in Safari: WebKit's on-disk IndexedDB over-reads a binary element of an array key
that is not the last element, so format 1 rows keyed `[table, ArrayBuffer, ArrayBuffer]` were looked up wrongly.
The browser IndexedDB store is now format 2 with plain string keys and unbounded `getAll()` reads. Upgrading deletes
every existing browser IndexedDB store; re-create or restore them. `Persistence.open()` replaces `meta()` and
`load(table)`, and the `keyRange` option of `indexedDbOpener` and `IndexedDbPersistence` is removed. A blocked open
rejects, and an abnormal connection close marks the adapter lost. `Manager` fails closed with
`MissingDurableStateError` when the keeper has rows but no `gbls.aeid`, instead of pinning defaults over the gap.
