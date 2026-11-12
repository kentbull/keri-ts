# ADR-0015: Pluggable store contract and browser durability model

- Status: Accepted
- Date: 2026-11-08
- Scope: The `DBer` storage contract, its LMDB, in-memory and browser backends,
  and durability semantics for a browser-embedded wallet
- Related: [DB invariants](../design-docs/db/db-architecture.md),
  [simple component flows](adr-0013-simple-component-flows.md),
  [package architecture](adr-0011-three-package-architecture.md),
  [DB parity plan](../plans/db/DB_PARITY_PLAN.md)

## Context

A fully capable wallet must run entirely in a web page, including Ionic/Capacitor
WebViews, over IndexedDB. Every domain store today is concretely LMDB: wrappers
hold lmdb-js handles, domain code opens writers through the native environment
and importing `keri-ts/db` loads the native addon.

The demonstrated need ADR-0013 requires is two concrete backends with a real
caller. Nothing here adds a repository hierarchy, a registry or a generic
service layer: there is one interface, and composition chooses its backend.

KERIpy `WebDBer` (`src/keri/db/webdbing.py`, `f05d200c`) proves the shape: a
sorted in-memory mirror serving synchronous reads and writes over browser
storage. Its model is flush-only BASE, reserializes each dirty store whole and
stores sync one at a time. keri-ts keeps the mirror and rejects that durability
model, because atomic multi-table publication is a keri-ts storage contract.

## Decision

Introduce `DBer`, a synchronous store contract with `LMDBer`, `MemStore` and
`WebDBer` implementations. This supersedes the provider-abstraction deferral in
D8 of the DB parity plan. It does not close D0–D7, and a backend passing the
contract suite makes no KERIpy parity claim. LMDB remains the parity reference.

Protocol-core behavior does not change. The LMDB refactor lands first with no
behavior change and before any browser code. Where this ADR is silent, observed
`LMDBer` behavior under the shared contract suite is the arbiter.

Type and method names below may be refined in the implementing PRs; the
semantics may change only by amending this ADR.

## Store contract

**Tables.** `openTable(name, {dupsort})` synchronously returns an opaque `Table`
valid only until close or reopen. A table's dupsort flag is fixed when the table
is created. A writable store creates an absent table. `openExisting` fails on one,
and on a readonly store an absent table yields no usable handle, so callers probe
`hasTable(name)`, which never creates, before binding an optional table. The
trailing-NUL table name spelling seen in Python-created layouts is an LMDB
backend detail.

**Primitives.** Backends implement only row access. `getVal` and `putVal`
(insert-if-absent, reporting whether it wrote), `setVal`, `delVal` (with an
optional value selecting one duplicate), `cnt`, duplicate-value add, read, count
and delete, a seek within one key's duplicates to the first value not below a
given value, and ordered scans. The `On*`, `IoSet*` and `IoDup*` families live in
shared backend-neutral code built on those primitives. `getVer`/`setVer` keep the
`__version__` marker semantics.

**Bytes and limits.** Keys and values are bytes compared as unsigned bytewise.
Empty values are valid on plain tables only. Writes reject an empty key, an
empty dupsort value, and a key or dupsort value longer than 1,978 bytes, the
pinned lmdb-js limit, with `DatabaseKeyError`, so one input cannot succeed on
one backend and fail on another. LMDB cannot hold an empty duplicate alongside
others, and no store needs one. `delVal` of an empty dupsort value reports absent. Point reads and
deletes reject an empty key and report an over-long key as absent. Reads of a
key's duplicates (`getVals`, `getValLast`, `getValsIter`, `cntVals`, `seekVal`)
report an empty key as absent too, and `delVals` follows the delete rule. Scan
bounds are not validated, so a bound over the limit compares as bytes like any
other. Backends copy on write and on read: returned bytes are caller-owned and
never alias the store, and a backend never writes into the options a caller
passes.

**Scans.** Options are `start`, `end`, `exclusiveStart`, `reverse` and `limit`.
`start` is inclusive unless `exclusiveStart` is set and `end` is always
exclusive. In reverse, `start` is the upper position, seeking to the greatest
entry not above it when absent, and `end` is the lower exclusive bound. Dupsort
entry scans order by key then value; reverse is the exact mirror of forward. A
keys-only scan of a dupsort table yields each key once: `limit` counts distinct
keys and `exclusiveStart` skips every duplicate at that key. `cnt` counts physical
entries, including duplicates. `refreshRead()` discards any retained read view so
a later read observes the latest commit; backends without retained views treat it
as a no-op.

A scan inside a writer sees that writer's earlier writes. Callers close scans
before suspending. A scan left open across another commit has no guaranteed
view, but a backend must not fail, or skip or repeat entries that commit did not
touch.

**Transactions.** `transaction(fn)` runs `fn` synchronously and returns its
result. A throw rolls back every effect and rethrows. `fn` must not suspend;
returning a thenable is a caller-contract error that non-LMDB backends reject,
and no caller passes one. Nesting is
a savepoint: a nested throw that the outer `fn` catches undoes only the nested
effects, and an outer rollback discards committed nested work. Only the
outermost commit publishes. A primitive write outside a writer is its own
transaction. `inWriteTransaction` distinguishes owning a commit from borrowing a
caller's writer; only the owner publishes cues after commit.

**`writeVersion`.** A number that increases on every outermost commit that wrote
rows and does not change on rollback or an empty commit. It is comparable only
within one open handle, and increments need not be one. A commit that only
creates a table or rewrites an identical row may or may not advance it.

**`flushed()`.** An Effection operation that completes when every commit made
before the call is durable, or fails with the store's recorded persistence
failure. Halting a waiter cancels only the wait, never queued writes.

**Lifecycle.** `reopen`, `openExisting` and `close(clear)` are Effection
operations, with `opened`, `readonly`, `name`, `base` and `temp` properties.
`openExisting` never creates and cannot clear. Writes to a readonly store throw.
Repeated close of a known-closed store is harmless, and a store whose close
failed cannot be reused or deleted. Each store has its own atomicity: independent
stores are not one transaction, as ADR-0013 already states.

## Backends

`LMDBer` implements the contract with lmdb-js, `PathManager`, map sizing and the
V1 data format exactly as today.

`MemStore` holds one bytewise-sorted map per table, emulates dupsort with sorted
values, and keeps a nestable undo log. `flushed()` completes immediately. It is
an explicit backend choice, never a hidden substitution in a parity-gated flow.

`WebDBer` is a `MemStore` mirror plus a separate `Persistence` adapter.
`IndexedDbPersistence` comes first; a SQLite adapter for Capacitor may follow
behind the same interface. An adapter provides:

- the list of persisted tables with their dupsort flags, and one table's rows;
- `write(batch)`, applying one batch atomically across all its tables;
- `clear()` and close.

A batch carries the row effects of a commit and any newly created tables. A row
is identified by `(table, key)`, or `(table, key, value)` in a dupsort table. An
adapter never reserializes a whole table.

Open bulk-loads every persisted table before returning, so reads never suspend.
`openTable` needs no prior declaration: on a writable store an absent table
starts as an empty mirror and is physically created by the batch that first
carries it, or by a batch of its own at `flushed()` or `close` when no commit has
carried it. IndexedDB can create an object store only during a version change,
which other open connections block, so that adapter must either handle
`versionchange` or keep logical tables inside one object store.

## Durability model

A `WebDBer` commit applies to the mirror synchronously and enqueues its batch.
This is write-behind, chosen so the synchronous domain transactions stay
synchronous instead of becoming operations at every call site.

1. **Prefix durability across composed stores.** The stores of one composition
   share one persistence queue, and batches apply one at a time in commit order.
   After page or process loss, those stores together equal their state after some
   prefix of that combined commit sequence. A transaction is never partially
   applied and no commit is skipped, so a Baser commit cannot survive the loss of
   an earlier Keeper commit. Stores remain separate atomic units: a crash can
   still fall between two commits, as it can on LMDB. Merging consecutive batches
   is permitted only if this holds.
2. **Durable means reported.** A commit is durable when the adapter reports its
   batch committed. `IndexedDbPersistence` requests strict durability on every
   batch. That is a browser hint, so power loss on a browser that ignores it is
   outside this contract.
3. **Failure latches.** The first failed write puts the queue, and so every store
   of the composition, in a failed state, because a later batch would create a
   gap. Further transactions throw, reads continue, and `flushed()` and `close`
   report the original failure. There is no
   retry, skip or storage-quota policy; exhausted storage is an ordinary failure
   under ADR-0013.
4. **Close joins.** `close` drains and joins the queue, including when cancelled,
   and reports failure.
5. **Page lifecycle is best effort.** Flushing on `pagehide` or
   `visibilitychange` narrows the loss window, but a browser need not wait for
   it, so it establishes nothing.
6. **Output barrier.** A browser composition must not release a request to the
   network until `flushed()` has completed on its shared queue. A published event
   must not outlive the local key state that produced it, and a lost key-store
   commit is not recoverable by replaying a KEL. Browser egress is HTTP only and
   every owner (Poster, witness submission, query and polling) uses the
   `HttpClient` that composition supplies, so the barrier belongs in that one
   client rather than in each producer. It applies to browser composition only
   and changes no LMDB behavior.

Callers that already await durability, Exchanger and Unblind, keep doing so
through `flushed()`.

## What a browser store may differ on

| Behavior                 | LMDB                                                          | Browser store                                                                                        |
| ------------------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Durability timing        | `transactionSync` is synced to disk before it returns         | Page or process loss can lose a suffix of commits not yet flushed                                    |
| Reader slots and handles | One handle per path per process                               | None                                                                                                 |
| Map size                 | Sized and persisted                                           | None; no accounting replaces it                                                                      |
| Physical format          | V1 files, inspectable with `tufa db dump`, shared with KERIpy | Private to the adapter; no migration from LMDB                                                       |
| Location                 | Filesystem `path`, an LMDB-only property                      | Store identity (`name`, `base`)                                                                      |
| Other writers/readers    | Multi-process through LMDB                                    | One writer guarded by the composition; a readonly handle sees a snapshot taken at open               |
| Storage retention        | Host filesystem                                               | Browsers may evict; the composition must request persistent storage and treat refusal as a real risk |
| `writeVersion`           | Continues across reopen and includes other processes' commits | May restart on reopen                                                                                |

Everything else in this contract and DB invariants A–E in the
[DB architecture contract](../design-docs/db/db-architecture.md) applies identically,
including key and duplicate ordering, idempotent add results, limits, copy
semantics, rollback and savepoint behavior.

## Consequences

- Wrappers and domain code depend on `DBer` and `Table`; lmdb-js types and `env`
  stay inside the LMDB backend.
- `keri-ts/db` becomes backend-neutral and the native backend moves behind an
  explicit subpath. ADR-0011's entrypoint list is amended when that split lands.
- One parameterized suite runs the same assertions against every backend, and
  backends are qualified in real browser engines before any wallet claim.
- A browser wallet adds a durability wait before output, so a slow store delays
  delivery. Requiring those waits is the point of the barrier.

Out of scope: Expo/React Native, migrating LMDB data into a browser store,
infrastructure roles in the browser and WebCrypto non-extractable key custody.
This ADR does not restore any removed accounting, quota or outbox behavior.
