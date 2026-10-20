# Storage learnings

[ADR-0013](../../docs/adr/adr-0013-simple-component-flows.md) owns the completed
accounting/durability removal and the prohibition on restoring it. Preserve
protocol evidence, transactions and actual resource cleanup.

LMDBer.inWriteTransaction owns pinned native writer inspection. Domain processors
use that boolean to distinguish owning a commit from borrowing a caller's writer;
do not cast the native environment or infer commit completion from a nested return.

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
and genus-selector settings remain actual wire semantics and snapshot on capture.
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

LMDB V1 live inspection needs the existing owner or separate processes. Opening
the same environment twice in one process can break reader slots, even readonly.
RegBaser owns the existing public registry evts/tels/heads layout; observer
accepted-chain reads and public engine intake share that same environment. Readonly old-store opening
binds existing tables without migration. RegBaser's absent anchor/escrow adapters
and RegistryStore's alias mapper are null on old layouts until explicit storage
writes initialize them; reads cannot migrate a store. Anchor tuples retain bigint
NumberPrimitive/Diger bytes and the earliest caller-verified source. The facade
stores markers, not protocol validity; the engine owns acceptance policy.
Do not suppress errors or weaken live-host assertions. Do not run command-local
mutations against a store still hosted by a stale runtime. Prefer narrow tufa db
dump selectors. Reacquire named handles after close/reopen.

Sender retry outbox storage and its records are removed. Provider Mailboxer
payloads and Baser topic cursors remain separate protocol stores.

## Payload ownership

PayloadStore.stage(signal) uses awaited Deno operations and private stages; finish
transfers an owner. No stage quota or before-write byte ceiling exists. Actual file
lengths, payload declarations and digest consistency remain validated by their
consuming owners. Fsync/close, concurrent-write rejection and joined abort cleanup
remain independent of accounting. Claiming an unpromoted local stage transfers mutation ownership while preserving
borrowed readers; other sources are copied. Stale cleanup cannot delete published
content. Each prepared file keeps its own UUID; scoped application keys such as
essr/SAID and plain/SAID live in the archive references, not filenames.

PayloadArchive publishes private references only after file/directory flushes,
with the owning DB commit. Startup scans incrementally, removes only unreferenced
owned content, and fails closed on missing referenced objects. The host exclusively
owns its archive directory across processes. File preparations may overlap; the
synchronous writer selects a reference after comparing bytes and rechecking current
ownership. Failed/duplicate candidates clean only their own files. Close joins
all admitted I/O; caller-owned writers are refused. Wire tables remain interoperable.

Baser owns archive lifetime. Qualified essrs rows preserve original ciphertext;
plaintext has separate storage and views. Private canonical wire retains repeated
fragments that IoSet rows may deduplicate. Python-origin rows without metadata
retain only the order/repetitions actually stored; the signed digest still decides
validity. Valid new evidence cannot silently bless corrupt retained evidence.

enst rows preserve child substreams. Private unique-admission stages replace rows
atomically with accepted/escrow state; failed replacement preserves prior rows.
Fresh children remain hydrated; reopened children own temporary ESSR files.
Cancellation claims/disposes every untransferred descendant.

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
publication stays inside its caller's transaction. Reopened frames are claimed
before cardinality checks and disposed after handler/replay completion or failure.
ESSR rows retain their actual insertion order, qualified framing and exact
size/count metadata without storage quotas. Parser and runtime/transport accounting are removed; actual file ownership remains.

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
