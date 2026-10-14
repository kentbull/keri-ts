# Payload ownership

CESR's `Payload` interface exposes a byte length and a reopenable async reader.
`collectPayload(payload, limit)` is the explicit bounded materialization boundary.
`MemoryPayloadSink` copies awaited writes into fixed-size slabs under its byte
limit. Neither interface depends on a filesystem or database.

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

1. `store.stage(maxBytes, signal)` returns an unfinished sink owned by the caller.
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
   idempotent on that handle. All readers must be finished before discarding or
   promoting their file.

Aborting a finished sink does not revoke the payload. Closing a store aborts its
unfinished sinks but does not delete completed caller-owned files. A parser can
therefore abort an incomplete later sibling without deleting a previously
emitted child.

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
introduce shared-content reference counting. Temporary names are discarded at
promotion because an incomplete stream has no final digest yet.

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
A previously unclaimed local file transfers ownership through `PayloadStore.adopt`; stale readers
remain usable, stale disposal is harmless, and stale promotion rejects. Other
sources copy through awaited bounded writes. A reopened file already referenced
by the archive is borrowed: publication under a new key copies it, and duplicate
publication never consumes the original. The synchronous `commit` callback
runs in the same LMDB transaction as the reference, after file contents and
all required directory entries have been flushed. Identical duplicate bytes
reuse the reference; conflicting bytes reject. Reference keys are nonempty ASCII
segments separated by `/`, at most 240 characters.
Final filenames replace separators with dots, so `essr/SAID` becomes `essr.SAID`
and `plain/SAID` becomes `plain.SAID`. Dots are forbidden in reference keys to keep
this mapping unambiguous. These names identify immutable owners; they are not
independent hashes of the qualified wire or plaintext. Equal bytes under distinct
keys keep separate lifetimes. Random UUIDs identify staging files only.

The private `payload.refs.` and `payload.owners.` tables belong together. They
must not be edited independently. Recovery scans files and records incrementally,
deletes unfinished stages and unreferenced objects, and fails closed on a missing
referenced object or inconsistent ownership. A failure after promotion but before
reference commit can leave a recoverable orphan. Removal commits reference
absence before unlinking its file. Mutations reject concurrent admission, and
close waits for already admitted work before releasing the runtime owner.
Admission is reserved before invoking callbacks, so reentrant mutations reject.

Archive views expose only reads. Existing readers must finish before reference
removal; removal does not provide reader leases. KERIpy-readable wire tables
remain separate from private file references and retain their protocol schema.

`Baser.getEssr` also reads KERIpy-origin exchanges that have `.essrs` rows but no
private metadata. It borrows their stored insertion order and deduplication,
admits finite byte/item limits, and reopens bounded chunks without retaining a
token list. Replay stays read-only; escrow retry snapshots the borrowed bytes and
uses normal archive publication. Imported rows and any supplied duplicate must
both match the signed commitment; valid duplicate fragmentation preserves the
first stored representation. Corrupt retained evidence is never silently blessed
by a valid new payload. The wire table does not retain the original
frame genus, so its reconstruction starts with v1 and replay raises the counter
genus when required by the body. Repetitions already deduplicated by KERIpy cannot
be reconstructed; the signed digest still decides whether the retained bytes
are valid.

## Nested exchange substreams

`enst.` retains KERIpy-compatible qualified CESR child substreams, in insertion
order with exact-value deduplication. It contains no file pointers or private
metadata. `db/exchange-nests.ts` prepares candidate rows in private `enst.stage.`
buckets keyed by a fresh admission UUID; the exchange transaction replaces the
public rows alongside accepted/escrow evidence. Rejection or cancellation removes
only that admission's candidate bucket. Exclusive archive startup clears abandoned
private stages and public rows without accepted/escrow ownership; Python-origin
owned rows require no private metadata.

Nested staging comparisons, publication and hydration admit each stored row
against diminishing 24 MiB aggregate wire credit before its owned backing copies.
The pinned lmdb-js 3.5.3 NAPI hook reads size without growing an insufficient
native target; supported binary, uncompressed, unversioned rows then copy under
that same transaction. Active writers are borrowed, while ordinary reads hold
an explicit snapshot. Unsupported bindings/modes fail closed. Publication still
belongs to the caller's transaction, so an over-limit suffix preserves earlier
public evidence on rollback; loading disposes previously hydrated descendants.

Exchanger borrows the runtime ResourcePolicy. Nested admission and replay reserve
104 MiB + 64 KiB before serializer construction or row copying: two 24 MiB owned
row copies, 24 MiB qualification, 24 MiB collected output, 8 MiB cursor backing
and one 64 KiB reader chunk. This conservative allowance stays held through joined
staging/descendant disposal, even on cancellation or cleanup failure. Reopened
parsers additionally charge ordinary wire (capped by each row's stored extent)
and each finite ESSR stage through their existing frame owners. FilePayload identity
and adoption remain intact. Route handlers borrow hydrated descendants through
handler completion; retaining additional copies afterward requires independent
credit. Busy/limit refusal precedes copying and does not establish message
invalidity; no automatic retry or waiter is introduced.

Native pre-existing scratch (initially 16 MiB) and LMDB mapped residency remain
separate, uncharged overhead. Other read paths can grow scratch or allocate whole
rows; KRAM snapshots, parent-factor reads, strings/native copies and final RSS
qualification remain open. Direct DB helpers require the caller's resource scope.
Standalone Exchanger defaults are finite but independent ledgers do not bound a
process. The 256 MiB default admits existing nested multisig and IPEX with shared
input frame owners, including 73 MiB reserved ingress/crypto coexistence in IPEX.
Remaining parent-tree credit still accounts for Texter-expanded ordinary bodies,
attachment groups, descendant nodes and ESSR bytes/items before acceptance:
8 MiB ordinary metadata, 8 MiB/16,384 ESSR bytes/items, 256 nodes and depth 64.
Reads release key cursors before suspension and stage ESSR in files, without
retaining a second array of complete ciphertext fragments.

Fresh parsed children remain hydrated through verification and handler execution.
Escrow retry and replay reopen stored child frames; their temporary ESSR stages
are released on completion, rejection, cancellation, or later-row corruption.
Successful verified duplicates replace the child row set and invoke forwarding
again, matching frozen Python `927c0cb8`. Failed replacement rolls back to the
previous public rows. Parent `/fwd` verification checks exactly one child's valid
body and the signed `a.evt` digest; child signature authentication belongs to its
recipient. No recursive dispatch occurs at the forwarder.
