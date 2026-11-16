# Browser IndexedDB format 2

keri-ts stores browser data in IndexedDB databases named `keri-ts:...`. Format 2 replaces format 1's array keys
`[table, ArrayBuffer, ArrayBuffer]` with plain string keys, because WebKit's on-disk IndexedDB mis-reads a binary
element of an array key that is not the last, which lost keeper rows such as `gbls.aeid` in Safari.

keri-ts refuses a format-1 database: opening it throws a `DatabaseOperationError` that names the database and
points here, and the database is left untouched. Upgrade each origin in one of two ways.

1. **Delete and re-create or restore (the default).** With every tab and wallet closed, load
   [`scripts/indexeddb-format-2-upgrade.js`](../../../scripts/indexeddb-format-2-upgrade.js) in the origin's devtools
   console (or app) and run `await keriIndexedDbFormat2.deleteKeriDatabases()`, then re-create the wallet or restore
   it from its other copy. Applications that hold a custody copy should do this.
2. **Migrate**, for stores with no other copy: before upgrading the code, run `await keriIndexedDbFormat2.migrate()`
   the same way. It rewrites every format-1 `keri-ts:` database as format 2. Never on Safari.

Safari caveat: on WebKit/Safari, format-1 keys are already corrupted on disk, so migration cannot repair them.
Delete and re-create or restore there.

## API changes

- `Persistence.open()` replaces `Persistence.meta()` and `load(table)`.
- The `keyRange` option of `indexedDbOpener` and `IndexedDbPersistence` is removed.
- `Manager` throws `MissingDurableStateError` when the keeper has rows but no `gbls.aeid`.
