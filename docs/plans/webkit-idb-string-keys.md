# WebKit on-disk IndexedDB: plain-string keys and unbounded reads

## Problem

In regular Safari tabs (desktop and iOS), whose IndexedDB is backed by SQLite on
disk, a wallet written through `WebDBer` + `IndexedDbPersistence`, closed and
reopened, reloads its keeper store without the `gbls.` `aeid` row while
`rroots.` rows remain. Keeper setup then throws a misleading
`DatabaseOperationError: Invalid registry root`, and the `Manager` constructor
has already written default `pidx`/`algo`/`tier`/salt over the empty `gbls.`, so
one bad load damages the store for good. Private tabs (in-memory backend) and
Chromium work. The browser lane used ephemeral contexts, so the on-disk backend
was never tested.

Root cause, confirmed on the iOS 26.5 Simulator Safari, on iOS Safari and on macOS Safari: WebKit's on-disk
IndexedDB key decoder over-reads any binary (`ArrayBuffer` or `Uint8Array`) element of an array key that is not the
last element. It returns the element with the next element's serialized header (tag `0x80` plus an 8-byte length)
and payload appended: `["gbls.", AB("aeid"), AB(0)]` reads back with a 13-byte `"aeid"` plus `0x80` and eight
zero bytes. Row counts and ranges are correct and string keys round-trip exactly. So `getGbls("aeid")` misses the
row. Playwright WebKit (builds 2215 and 2359, Safari 26.6) does not have the bug, so the persistent lane cannot
reproduce it: it guards the on-disk format and the reload path, not this decoder. The rule is that no IndexedDB key
contains a binary element at all; binary lives only in values.

This change removes binary key parts and ranges entirely and fails closed when state is missing.

## Design

`WebDBer` is a `MemStore` mirror: it loads every table on open, sorts in memory,
and only ever asks storage to persist rows by exact identity. So storage needs no
ordering, ranges, or comparable keys.

- **Rows.** Out-of-line plain string key `${hex(key)}.${hex(dup)}.${table}`
  (`dup` empty on a plain table). Hex has no `.`, so the first two dots delimit
  and the table name is the remainder. Value is a self-describing record
  `{t, k, v}` with `ArrayBuffer` key and value. A plain put on the same
  `(table, key)` overwrites; each duplicate has its own id; deletes rebuild the
  exact id.
- **Meta.** One record per table, `table:${name}` → `{kind: "table", name, dupsort}`, plus `version` → `{kind: "version", version}`. Per-table records keep
  table creation atomic with the batch that adds it and never need a
  read-modify-write.
- **Open.** `Persistence.open()` replaces `meta()` and `load(table)`: one readonly
  transaction over `rows` and `meta`, two unbounded `getAll()` calls, grouped by
  `t`, returning `{version, tables: [{name, dupsort, rows}]}`. No `IDBKeyRange`,
  no array or binary keys, no index, no pairing of `getAllKeys` with `getAll`. A
  row whose table has no meta record throws `MissingDurableStateError`.
- **Format.** Database version 2 under the same name (the store lock key and
  callers that locate a store's databases depend on the name). Upgrading from 1 deletes and recreates both stores: no
  migration, per the no-compatibility rule; the changeset says browser stores
  are wiped and must be restored or re-created.
- **Open blocked.** Reject a blocked `open` with a named error instead of
  hanging; close the connection if it later succeeds.
- **Abnormal close.** `db.onclose` marks the adapter lost with a named error, so
  the next write latches with a clear cause. Reconnect after WebKit kills the
  connection is deferred: it changes ADR-0015's "a write never reconnects".
- **Keeper fails closed.** Before the `Manager` constructor pins any default, a
  Keeper check throws `MissingDurableStateError` when `gbls.aeid` is absent but a
  non-`gbls.` keeper table has rows. A store with only some `gbls.` pins (a crash
  during first init) still opens.

## Tests

- Unit (fake-indexeddb): id encoding, overwrite, distinct duplicates, exact
  deletes, isolation of `a.` from `a.b`, a table name containing `.`, empty
  values, an empty table keeps its dupsort flag, orphan rows throw, v1 → v2 wipes,
  blocked open rejects; keeper guard throws before any pin, tolerates a
  `gbls.`-only partial init, passes a fresh store.
- Browser persistent lane (`test:browser:persist`): one server for both phases;
  `launchPersistentContext(dir)` writes a keeper-shaped store (`gbls.` rows, 100
  deterministic 89-byte `rroots.` keys, a dupsort table) and a real web wallet,
  closes the context, relaunches on the same directory and verifies every row and
  the wallet reopen. WebKit, with Chromium as control; runs in the browser CI job.
  Playwright WebKit passes on the v1 adapter, so the lane guards the format only;
  the decoder bug was verified in real Safari (iOS Simulator, iPhone, macOS).

## Release

Release-impacting patch for `keri-ts` and, through exact pins, every dependent
package. Applications must expect an empty browser store after upgrading and
restore or re-create it.
