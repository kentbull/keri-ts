# Payload ownership

CESR's `Payload` interface exposes a byte length and a reopenable async reader.
`collectPayload(payload, signal)` materializes exactly that declared extent and
rejects an overlong or truncated reader, including closing the source on failure.
It accepts no collection quota. `MemoryPayloadSink(signal)` copies awaited writes
into fixed-size slabs without a byte limit. Neither depends on files or a database.

`OwnedPayload` adds explicit `discard()` to the read-only payload view. Every
sink returns an owner. Memory disposal releases its slabs; file disposal removes
its file. Views become invalid when their owner is discarded.

`PayloadStore` uses Deno filesystem APIs and `@std/path`. It stages files using
private permissions and temporary Web Crypto UUID names. Each
write must be awaited; a sink rejects concurrent operations instead of growing
an internal write queue. It handles partial writes and closes its descriptor on
completion or abort. Cancellation waits for the current bounded file operation
to settle before cleanup.

The ownership sequence is:

1. `store.stage(signal)` returns an unfinished sink owned by the caller.
2. `sink.finish()` flushes and closes the file, transferring ownership to the
   returned `FilePayload`. The caller must promote or discard that result.
3. `payload.promote(id)` publishes under a caller-supplied SAID or scoped digest
   name, then removes the temporary stage. A hard link makes the complete file
   visible atomically and rejects an existing name instead of overwriting it.
   `payload.id` becomes that final identity, reopened with `store.open(id)`.
   Prefix separate representations such as `essr.<EXN SAID>` and `plain.<EXN SAID>`
   to keep their ownership independent. A byte digest is appropriate when no
   protocol SAID exists; it does not make arbitrary bytes a self-addressed document.
4. `payload.discard()` explicitly deletes the owned stage or object. It is
   idempotent on that handle. Already-open readers keep their descriptors; future
   opens require the file to remain owned. Promotion preserves borrowed views.

Aborting a finished sink does not revoke the payload. Closing a store aborts its
unfinished sinks but does not delete completed caller-owned files. Storage abort therefore cannot revoke an already transferred file.

Readers open independent descriptors and close them on EOF, failure, or early
iterator return. An optional `AbortSignal` reaches reads and collection; source
implementations that await external input must themselves honor that signal.
Calling `return()` on an async generator alone cannot interrupt its pending
`next()` call.

The npm build translates these Deno calls through its packaging shim, including
file and directory fsync. Its installed-package smoke test exercises this path;
the native Deno implementation has no Node filesystem imports.

Final IDs are flat, at most 240 characters, and contain ASCII letters, digits,
underscores, hyphens, and nonempty dot-separated scopes. The caller supplies and
verifies the identity; the file store does not interpret protocol content or
introduce shared-content reference counting. A caller may keep the stage UUID
as an independent immutable object identity, as PayloadArchive does.

This module does not publish database references, sweep orphan files, or claim a
transaction spanning file promotion and LMDB. Those operations require explicit
storage ownership and crash recovery. It does not modify KERIpy-readable tables
such as `.essrs` or mailbox `msgs.`. Decryption, verification, and the choice to
retain ciphertext or plaintext belong to runtime consumers.

## Durable references

`PayloadArchive.open(db, root, signal)` recovers a private directory before
admitting work. Cancellation is checked between recovery entries. The host must
own that directory exclusively across processes. The archive also rejects
duplicate owners within one process, including path aliases. This is an explicit
host requirement, not a PID-file lock or a lease.

`publish(key, payload, commit, signal)` stores immutable bytes under an
application key.
An unpromoted local stage transfers ownership through `PayloadStore.claimStage`;
borrowed readers remain usable, stale disposal is harmless, and stale promotion
rejects. Other sources copy through awaited writes. Each candidate keeps its own
UUID through promotion, independent of its application key. The synchronous
`commit` callback runs with reference publication in the same LMDB transaction,
after file contents and directory entries have been flushed. Byte comparison may
suspend; recheck the compared reference before selecting it in the synchronous
writer. Identical duplicates reuse the retained file; conflicting bytes reject.
Reference keys are nonempty ASCII segments separated by `/`, at most 240
characters. Scoped keys such as `essr/SAID` and `plain/SAID` keep representations
independent; equal bytes under distinct keys keep separate file lifetimes.

Domain owners can instead `prepare(payload)` without publishing a reference,
then `pin(key, candidate)` in their own synchronous writer after validation.
`referenceId(key)` identifies the immutable evidence read before suspension.
A candidate belongs to one publication attempt, including a rolled-back attempt;
dispose it before closing its database. Disposal consults committed ownership
and cannot delete a referenced file. Join the owning writer's flush before effects.

The private `payload.refs.` and `payload.owners.` tables belong together. They
must not be edited independently. Recovery scans files and records incrementally,
deletes unfinished stages and unreferenced objects, and fails closed on a missing
referenced object or inconsistent ownership. Ordinary failed/duplicate candidates clean only their own files; interruption
between promotion and commit can leave a recoverable orphan. Removal commits
reference absence and waits for its flush before unlinking that exact object.
Independent preparation, comparison and deletion may overlap. Close joins all
admitted I/O before releasing the runtime owner. Caller-owned writers are refused
so an outer rollback cannot invalidate a completed publication/removal.

Archive views expose only reads. Already-open readers survive reference removal;
future opens have no lifetime guarantee after removal. There are no reader leases.
KERIpy-readable wire tables remain separate from private file references and
retain their protocol schema. Plaintext offset metadata is checked against current
accepted metadata in its reference-publication transaction.

`Baser.getEssrs` returns ordinary ordered Texters. Private archive bytes retain
exact qualified codes, fragment order and multiplicity; KERIpy IoSet rows alone
cannot represent repeated equal fragments. KERIpy-origin accepted/escrow rows
remain readable without private metadata, with their actual insertion order and
deduplication. Replay is read-only. Retry uses normal archive publication.

Retained evidence and a supplied duplicate must both match the signed commitment.
A legal duplicate fragmentation keeps the first representation. Already
KERIpy-deduplicated fragments cannot be reconstructed; the signed digest still
decides validity. Private metadata retains attachment genus independently of the
body protocol. ESSR rows, reference metadata and accepted/escrow evidence publish
in the same transaction after the archive's actual file work completes.

## Nested exchange substreams

`enst.` retains KERIpy-compatible qualified CESR child substreams, in insertion
order with exact-value deduplication. It contains no file pointers or private
metadata. `db/exchange-nests.ts` prepares candidate rows in private `enst.stage.`
buckets keyed by a fresh admission UUID; the exchange transaction replaces the
public rows alongside accepted/escrow evidence. Rejection or cancellation removes
only that admission's candidate bucket. Exclusive archive startup clears abandoned
private stages and public rows without accepted/escrow ownership; Python-origin
owned rows require no private metadata.

Nested staging comparisons, publication and hydration read one physical row at a
time through ordinary owned native copies. Key cursors close before suspension.
Publication belongs to the caller's transaction, so a write failure rolls back to
the previous public evidence. Loading requires exactly one finite child per row. Decoding creates ordinary
values with no parser files or disposal obligations.

Exchanger has no resource policy, recursive tree budget or storage-copy reservation.
Handlers consume hydrated descendants through route processing. Admission guards
protect unfinished publication and archive recovery. Fresh parsed children remain
hydrated; retry and replay decode stored rows through the same finite decoder.
Successful verified duplicates replace the child row set and invoke forwarding
again, matching frozen Python `927c0cb8`. Failed replacement rolls back to the
previous public rows. Parent `/fwd` verification checks exactly one child's valid
body and the signed `a.evt` digest; child signature authentication belongs to its
recipient. No recursive dispatch occurs at the forwarder.

KRAM ready/partial snapshots and their copy-admission helpers are removed.
KERIpy-supported partial factors, replay caches and actual accepted payload
ownership remain distinct. Ordinary database row reads have no byte ceiling or
before-copy callback. ESSR storage and recipient crypto have no byte/item or
concurrency quotas; application accounting must not be reintroduced.
