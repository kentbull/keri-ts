# Storage learnings

[ADR-0013](../../docs/adr/adr-0013-simple-component-flows.md) owns the completed
accounting/durability removal and the prohibition on restoring it. Preserve
protocol evidence, transactions and actual resource cleanup.

[ADR-0015](../../docs/adr/adr-0015-pluggable-store-contract.md) owns the pluggable
`DBer` contract and browser durability; `LMDBer`, `MemStore` and `WebDBer` implement it and
LMDB remains the parity reference. Nested transactions are savepoints. Browser stores commit
to their mirrors synchronously and share one prefix-durable queue per composition;
the first persistence failure latches, and the browser HttpClient waits on `flushed()`.
`BaseDBer` owns the ordinal, IoSet and IoDup families over backend row primitives.
Wrappers hold opaque `Table` handles; only LMDB-specific code may call `lmdbTable()`.
Dupsort `scanKeys` yields each key once, unlike entry `scan`; use `seekVal` to seek
within one key's duplicates. Native table-name spellings stay inside `hasTable`.
Domain code commits through `transaction`, waits through `flushed` and compares
`writeVersion`; a rebound `Table` handle, not `env`, detects that a store reopened.
`StoreIdentity` names a store on every backend; paths and map size are `LmdbLocation`.
`PathManager` follows hio `Filer` for persistent stores, so compare against the pinned hio, not KERIpy alone: each open retries the primary head, and `headDirPath` never changes on fallback. Config files are `keri/cf/{base}/{name}.json`. Temp stores deliberately keep one directory per name so tests can reopen them; KERIpy never sees them.
Domain stores become `StoreOwner`s over an injected `DBer`; a `StoreOpener` places each `StoreFamily`, and `lmdbDefaultsFor` reproduces the established LMDB paths exactly. Domain stores compose this way; the `lmdb*` factories build each default. `openHabery` takes an opener or borrowed `stores`, which it never closes; `createHabery` is its LMDB default. `keri-ts/db` and `keri-ts/runtime` must not reach the addon; LMDB lives behind `keri-ts/db/lmdb`, and the boundary check walks value imports only.

`MemStore` is one sorted row array per table with an undo log whose savepoints are
indexes, so scans must re-seek from their last row rather than hold an index. Probing
`LMDBer` in Linux found behavior the ADR does not state: exclusive start on a dupsort
entry scan skips every duplicate at that key; empty scan bounds count as absent;
negative `limit` yields nothing; and a plain table's `delVal(key, val)` ignores `val`.
LMDB cannot hold an empty dupsort value beside others (it silently dropped one when a
second arrived, and refused to add one with `MDB_BAD_VALSIZE`), so ADR-0015 rejects an
empty dupsort value with `DatabaseKeyError` on every backend and `delVal` of one is
absent; empty values stay valid on plain tables. `addVal` takes a non-null value.
`test/unit/db/store-contract.ts` runs one set of assertions over `LMDBer` and `MemStore`; new `DBer` behavior
lands there first. It found three LMDB-only faults, now fixed: lmdb-js writes into the
options it is given (`getKeys` sets `values: false`), so a reused `ScanOptions` made a
later `scan` yield empty rows; an empty key read as the table's first key for duplicate
reads; and over-long `end` or `seekVal` bounds threw. `writeVersion` is only promised to
grow on row writes: LMDB also advances for table creation and identical dupsort pairs.

`WebDBer` extends `MemStore` through two protected hooks: `committed` receives each
outermost commit's changes, and `loadContents` installs a snapshot. A batch holds each
row identity's first prior state against its latest, so a savepoint rollback, which pops
the undo log, can never leak into one; a commit ending where it began writes nothing.
One `PersistenceQueue` per composition is a promise chain outside Effection, so halting
a waiter cannot cancel a write. The first failure latches every store on that queue:
commits already in the mirror stay readable, later transactions throw, and recovery is a
new composition loading the durable prefix. An unwritten table rides the next batch, or
a table-only batch at `flushed` or `close`, so its dupsort flag persists.

`IndexedDbPersistence` keeps all logical tables in one `rows` object store (keys
`[table, key, valueOrEmpty]`, `ArrayBuffer` parts) plus a `meta` store, so a new table never needs
a schema upgrade that another tab's open connection could block. A write is one strict
`readwrite` transaction settled on `complete`; a request's `success` fires before the
commit is final. `versionchange` closes the connection and the adapter then refuses
`load` and `write` until a new `meta`, because writing on after another context deleted the
database would break prefix durability. A blocked `deleteDatabase` stays pending in the
browser, so `clear` rejects rather than hanging. `fake-indexeddb` honors all of this, but
real-engine behavior (durability hints, eviction, blocked ordering) is only checked in PR 14.
It is public only as `keri-ts/db/indexeddb` (`IndexedDbPersistence`, `indexedDbOpener`), never from
`keri-ts/db`, whose Node consumers must not type-check DOM types.

`@keri-ts/wallet` splits by backend: the root keeps LMDB `createWalletBaser` and stays Node-only
(no `browser` condition); `@keri-ts/wallet/web` has the same surface minus LMDB plus
`openWalletBaser(opener, identity)`. Open application stores through the composition's opener
(`hby.opener`) so they share its one `WebStoreOpener` queue.

Browser host duties live in `keri-ts/runtime/web`. `barrierHttpClient` (ADR-0015 rule 6) waits on
`WebStoreOpener.queue.flushed()`, not one store's `flushed()`: the queue is shared by every family
and is the only handle that orders all commits. A latched queue fails the request with
`OutputBarrierError` and sends nothing; the wrapper drops `tcp` so no dialer bypasses it.
`acquireStoreLock` takes `navigator.locks` before any `reopen` because the mirror is a snapshot, keyed
`keri-ts:store:[base,name,durable|temp]` (the IndexedDB database name minus the family); an absent
API fails closed. Real-browser lock and eviction behavior is unverified until PR 14.

LMDBer.inWriteTransaction owns pinned native writer inspection. Domain processors
use that boolean to distinguish owning a commit from borrowing a caller's writer;
do not cast the native environment or infer commit completion from a nested return.

Manager authenticates AEID changes and prepares replacement crypto before writes.
Keeper.changeEncryption owns one native transaction for root/prefix salts, signer
seeds, encrypted registry roots and AEID, rechecks expected policy under the writer and rejects false writes.
Readonly and borrowed writers cannot change this policy. Publish Manager crypto
only after commit; same-AEID changes preserve stored ciphertext. Registry roots are
immutable Salt128 Cipher values in `rroots.`. Retention authenticates the live AEID
and rechecks it inside its owned writer, refusing stale Managers and borrowed
writers. Retained roots prevent disabling encryption.

## Database truth

Baser owns accepted KEL row layout and prospective first-seen metadata. Its
prepareKelEventLog/writeKelEventLog seam consumes verified material and the
processing owner's delegated fact under the existing synchronous writer.
It emits no cues and owns no transport work; Kevery publishes after commit.

Use typed Suber/Komer seams and the [DB invariants][db]. Symbol presence does not
prove row parity; the [DB plan](../../docs/plans/db/DB_PARITY_PLAN.md) retains Partial
rows until evidence closes them. Record models are FooRecord plus FooRecordShape,
with recordClass as the durable seam. Protocol/storage CBOR uses CESR's codec.
Full event-seal discovery scans raw KEL `a` entries and skips other shapes;
strict Serder seal projection remains opt-in. Accepted digest/opaque data must
not hide a later fully witnessed tuple anchor.

Use the repository-pinned LMDB release (runtime source currently 3.5.3), V1 data
format for KERIpy interop, and the actual native rebuild path.
Deno rebuilds with official `ENABLE_V8_FUNCTIONS=false`: Node-header V8 imports
can terminate Deno on the large-row mapped-buffer path. Native Node may use the
pinned official V8 build with matching compiled/runtime major and enabled V8
acceleration. Ordinary native reads copy whole rows. Row size billing, prototype
hook probes and before-copy callbacks are removed; no storage policy may return.
Qualify actual addons under both runtimes, including rows above 16 MiB, owned
bytes surviving replacement/later reads, and active writer access.
TEL capture metadata retains no event bodies or cursors. Readers close each
cursor before clone/yield, including reopened stores. No message/proof ceiling
or canonical pair/brand inspection remains. Tevery composes management then
credential iterables directly, preserving missing and duplicate ranges. Genus
and genus-selector settings snapshot on capture. TEL replay honors the requested
version exactly; incompatible stored bodies throw UnsupportedTelReplayError before
that event is yielded, even without attachments. Earlier iterator output is not
rolled back. Tevery uses actual parsed request genus; v1 output has no v2 selector.
KEL replay captures immutable identity/ordinal horizons without event bytes or
open cursors. It has no message/depth ceiling or copy accounting. Cycle detection,
ordinal validity, current proof reads and cursor closure remain correctness rules.
cloneEvtMsg calculates actual framing lengths once; it has no retain/admit wrapper.
Witness GET no-SN captures target-only FEL ranges; SN captures KEL/FEL horizons
and seeks physical duplicate proems without rescanning buckets or holding a
cursor across hydration. Deleted earlier duplicates do not shift the checkpoint.
New accepted duplicates beyond the FEL horizon are excluded; current index/proof
metadata is not an immutable snapshot. Broad no-SN proof skip and native proof-copy
qualification remain open; do not turn that path into a native-failure guarantee.
Native CI caches include NAPI and rebuild-script identity; every cache hit must
pass both native metadata and emitted V1-format probes before reuse. A lockfile
can retain older packages; inspect the imported addon. Map sizing respects explicit
options, KERI_LMDB_MAP_SIZE/KERI_BASER_MAP_SIZE and stored metadata.

LMDBer joins native close completion and cancellation. Observable failures propagate
for every handle; an uncertain wrapper exposes no usable env and cannot reopen
or delete storage. Known-closed repetition is harmless. `openExisting` remains
non-creating and cannot clear storage; this policy is independent from shutdown.
Pinned lmdb-js 3.5.3's callback follows actual doClose, while its Promise can resolve
early for deferred reads; its internal native-close catch is a binding limitation.
The old arbitrary timer drain is removed. Explicit owners preserve simultaneous
operation/cleanup failures and Habery attempts all owned closes.

LMDB V1 live inspection needs the existing owner or separate processes. Opening
the same environment twice in one process can break reader slots, even readonly.
Pending-OOBI cleanup uses ordinary writable Baser loading and its canonical
`oobis` table with `>` separator. Preview deletes no selected rows but accepts
normal schema initialization and habitat reload/cleanup. Normal path preparation
may create empty directories; a data.mdb check refuses missing databases before
Baser can create one. Shared baserDefaults keeps that path check consistent with
normal loading. No OOBI store/opener or alternate startup mode remains.
Generic LMDBer.openExisting remains non-creating and separate from this command.
`tufa oobi clean` validates exact keys before opening, preflights every row and
reports completed/remaining operations on failure. Its complete/failed status
follows explicit Baser closure; close failure never implies deletion rollback.
Adjacent OOBI tables are not cleanup targets.
RegBaser owns the existing public registry evts/tels/heads layout; observer
accepted-chain reads and public engine intake share that same environment. Readonly old-store opening
binds existing tables without migration. RegBaser's absent anchor/escrow adapters
and RegistryStore's alias mapper are null on old layouts until explicit storage
writes initialize them; reads cannot migrate a store. Anchor tuples retain bigint
NumberPrimitive/Diger bytes and the first caller-verified source. The facade
stores markers, not protocol validity; the engine owns acceptance policy.
Do not suppress errors or weaken live-host assertions. Do not run command-local
mutations against a store still hosted by a stale runtime. Prefer narrow tufa db
dump selectors. Reacquire named handles after close/reopen.

Sender retry outbox storage and its records are removed. Provider Mailboxer
payloads and Baser topic cursors remain separate protocol stores.

## Exchange evidence

LMDB owns accepted and escrowed ESSR evidence. Target actual pinned-main Baser
`essrs.` through `CesrIoSetSuber<Texter>`: qualified-value deduplication and
first-insertion order, including append/set semantics on redelivery. False from
duplicate add is normal; actual storage exceptions abort publication. Repeated
fragments can lose committed bytes; alternate representations can append bytes.
Keep incoming and reconstructed digest verification distinct; do not restore
ordinal writes or a first-representation policy to conceal this reference limitation.
`Baser.getEssrs` reads owned evidence synchronously. Validation, proofs, fragments,
receipt provenance and state publish in one ordinary LMDB transaction. Replay
uses stored members, as do retry and recipient processing. Recipients reject a
damaged reconstructed digest before decryption. Legacy pins bind `.essrs`, not
main's `essrs.`; manually named typed readers do not prove actual Baser parity.
Direct legacy LMDB support is deferred in the DB roadmap; legacy wire remains required.
No archive, file references, recovery sweep or durable plaintext store remains.

`enst.` retains ordinary qualified child substreams. Resident child serialization
precedes the synchronous writer; publication replaces its rows inside that writer.
Failure rolls back the body, proofs and nested rows together. Retry and replay
hydrate ordinary finite frames; no private staging database or file lifetime exists.
Recipient decryption synchronously reads accepted LMDB evidence and returns
caller-owned authenticated inner bytes. No file staging, views, sinks or durable
plaintext APIs remain. Actual transport sources and frame serialization survive
independently of ESSR storage.

Opaque pathed evidence uses byte-preserving insertion-ordered storage. UTF-8
replacement can merge different binary members; never decode wire just to obtain
a storage or deduplication key. `Baser.ptds` retains raw bytes through reopen.

KRAM factor helpers stage rows inside the caller's transaction and validate the
stored union before commit. Compare qualified bytes and keep sender pmks separate
from foreign proof groups. Known last references freeze receipt coordinates;
unresolved markers survive reopen without retaining their signatures. Private
ready/snapshot/handoff storage and factor accounting are removed. Partial factors
and accepted/replay state remain protocol-owned.

## Nested evidence and actual ownership

Nested storage uses ordinary owned native row copies with no preflight billing,
parent-tree budget or storage-copy reservation. Key cursors close before suspension;
publication stays inside its caller's transaction. Reopened frames are ordinary values with no disposal obligation.
ESSR rows retain their order, multiplicity and qualified framing without storage quotas.

Stored reply reconstruction uses the typed reply store, 714 key-ordered groups
and exactly one optional cigar. The shared serializer owns framing; do not duplicate
its counter-size rules for speculative admission. Missing bodies stay empty and
invalid keys, missing authenticators and storage errors propagate. Reconstruction
does not authenticate those proofs for the receiver.

[db]: ../../docs/design-docs/db/db-architecture.md

Mailbox publication commits opaque body and ordered topic together. Identical
bodies overwrite successfully while repeated topic appearances keep distinct
ordinals; zero is a valid first ordinal. False pin/invalid ordinal is an invariant
failure and rolls back publication. This is a TS atomicity extension over714's
two-write storeMsg, not a shared-copy/native admission claim.
