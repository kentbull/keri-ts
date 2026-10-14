# Storage learnings

## Database truth

Use typed Suber/Komer seams and the [DB invariants][db]. Symbol presence does not
prove row parity; the [DB plan](../../docs/plans/db/DB_PARITY_PLAN.md) retains Partial
rows until evidence closes them. Record models are FooRecord plus FooRecordShape,
with recordClass as the durable seam. Protocol/storage CBOR uses CESR's codec.
Full event-seal discovery scans raw KEL `a` entries and skips other shapes;
strict Serder seal projection remains opt-in. Accepted digest/opaque data must
not hide a later fully witnessed tuple anchor.

Use the repository-pinned LMDB release (runtime source currently 3.5.3), V1 data
format for KERIpy interop, and the actual native rebuild/preflight path.
Rebuild with official `ENABLE_V8_FUNCTIONS=false`: Node-header V8 imports can
terminate Deno when a large row first reaches the mapped-buffer path.
Qualify the actual addon under both runtimes, including rows above 16 MiB. A lockfile
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

## Open boundary

Whole LMDB rows are allocated before current size checks. Finite row ceilings and
per-tree budgets do not prove admission before allocation or a runtime-wide bound.
[Resource phase 4](../../docs/plans/runtime/RESOURCE_POLICY_PLAN.md) and
[storage phase 5](../../docs/plans/db/STORAGE_RECOVERY_PLAN.md) jointly own closure.
See the [payload contract](../../docs/design-docs/db/PAYLOAD_STORAGE.md).

[db]: ../../docs/design-docs/db/db-architecture.md
