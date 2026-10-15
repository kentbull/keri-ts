# Storage learnings

## Removal precedence (2026-10-15)

[ADR-0013](../../docs/adr/adr-0013-simple-component-flows.md) now requires removal
of all application budgeting and unsupported outbox, mailbox consumer-ack and
KRAM ready/snapshot durability. Any descriptions below of credits, reservations,
capacity admission or those delivery guarantees describe transitional code, not
instructions to preserve it. Remove those passages with their owning code rounds.
Preserve independent wire/crypto/transaction correctness and actual cleanup.
Only a minimal private socket constraint justified by production evidence may
remain; no parser, domain, storage, runtime or CLI accounting exception exists.

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
format for KERIpy interop, and the actual native rebuild/preflight path.
Deno rebuilds with official `ENABLE_V8_FUNCTIONS=false`: Node-header V8 imports
can terminate Deno on the large-row mapped-buffer path. Native Node may use the
pinned official V8 build with matching compiled/runtime major and enabled V8
acceleration. Preflight may create a mapped view, never an owned row copy before
admission; mapping residency/metadata and fixed scratch remain separate overhead.
Qualify actual addons under both runtimes, including rows above 16 MiB.
TEL capture metadata and fixed pair composition own no event bodies or cursors;
consumer readers close each cursor before clone/yield, including reopened stores.
TEL replay preflights body rows before copies and reads native dupsort signatures
incrementally, checking its ceiling before payload retention. Each native duplicate
is finite (LMDB's 511-byte maximum); ordinary standalone hydration, native scratch
and mapped residency remain separate qualification limits.
Finite KEL replay preflights event bodies before owned copies; HTTP source credit
must cover reconstruction before iterator acquisition, not only yielded bytes.
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

Optional mailbox outbox publication and terminal pruning commit complete rows
together. Runtime retries use keys-only live scans and bounded native metadata/payload
reads before copies; caller credit lasts through transport and cursor cleanup.
Ordinary scans, pending counts and outcome/pruning reads remain outside that claim.
That transaction does not bridge accepted KEL state to initial cue transfer.

## Payload ownership

PayloadStore uses awaited Deno operations and private stages; finish transfers an
owner. Adopt transfers mutation ownership while preserving borrowed readers, so
stale cleanup cannot delete published content. Use scoped identities such as
essr.SAID/plain.SAID; UUIDs belong only to temporary admission/staging. These owner
names are not independent byte hashes.

PayloadArchive publishes private references only after file/directory flushes,
with the owning DB commit. Startup scans incrementally, removes only unreferenced
owned content, and fails closed on missing referenced objects. The host exclusively
owns its archive directory across processes. Wire tables remain interoperable.

Baser owns archive lifetime. Qualified essrs rows preserve original ciphertext;
plaintext has separate storage and views. Private canonical wire retains repeated
fragments that IoSet rows may deduplicate. Python-origin rows without metadata
retain only the order/repetitions actually stored; the signed digest still decides
validity. Valid new evidence cannot silently bless corrupt retained evidence.

enst rows preserve child substreams. Private unique-admission stages replace rows
atomically with accepted/escrow state; failed replacement preserves prior rows.
Fresh children remain hydrated, reopened children own temporary ESSR files, and
remaining tree credit diminishes across rows. Cancellation claims/disposes every
untransferred descendant.

Opaque pathed evidence uses byte-preserving insertion-ordered storage. UTF-8
replacement can merge different binary members; never decode wire just to obtain
a storage or deduplication key. `Baser.ptds` retains raw bytes through reopen.

KRAM factor helpers stage rows inside the caller's transaction; validate the full
stored union before commit. Hydration shares 4096-item/8 MiB credits across the
incoming and durable union, compares qualified bytes, and keeps sender pmks
separate from foreign proof groups. Known foreign last references freeze receipt
coordinates; unresolved markers survive reopen without retaining their signatures.
Factor cleanup excludes cache, accepted exchange and snapshot/handoff ownership.

Private KRAM `kpnd.` snapshots retain complete nested/ESSR wire until downstream
consumption. Scalar factors hydrate independently; snapshot parent attachments do
not reconstruct authentication inputs. Incoming trees stay borrowed; reopened
file owners remain Effection-scoped. Cancellation joins serialization/parser work
before disposal, and scope exit attempts every descendant owner. Parent/child
storage does not accept either message or publish ordinary exchange wire.
Explicit-credit snapshot identity/publication facilities admit native copies before
allocation and retain serialization credit through joined cleanup and publication.
Register passive credit before abortable leaves; a plain finally can release it
while cancelled source cleanup still runs. Runtime KRAM borrows the same ledger as
Exchanger. Hydration releases row/cursor credit only after parser closure; actual
frame credit stays through scoped callback disposal without wrapping FilePayload.

## Open boundary

Nested wire reads use the pinned native size preflight before owned row copies;
active writers stay borrowed and ordinary reads share one explicit snapshot.
Exchanger borrows runtime credit before nested row/serialization copies and holds
it through joined admission/replay cleanup; reopened parser credits stay on actual
frame owners. Keep both owned row copies charged. Direct DB helpers need a caller
scope. Other LMDB APIs and parent-factor reads still allocate before checks; fixed native
scratch and mapped residency remain separate overhead, so this is no RSS bound.
[Resource phase 4](../../docs/plans/runtime/RESOURCE_POLICY_PLAN.md) and
[storage phase 5](../../docs/plans/db/STORAGE_RECOVERY_PLAN.md) jointly own closure.
See the [payload contract](../../docs/design-docs/db/PAYLOAD_STORAGE.md).

Stored reply body preflight, retained proof-row ceilings and final wire-size
admission are separate from native proof-row decoding/copy admission. Stored
reply reconstruction uses 714 key-ordered groups and exactly one optional cigar;
source construction does not authenticate those proofs for the receiver.

[db]: ../../docs/design-docs/db/db-architecture.md

Mailbox publication commits opaque body and ordered topic together. Identical
bodies overwrite successfully while repeated topic appearances keep distinct
ordinals; zero is a valid first ordinal. False pin/invalid ordinal is an invariant
failure and rolls back publication. This is a TS atomicity extension over714's
two-write storeMsg, not a shared-copy/native admission claim.
