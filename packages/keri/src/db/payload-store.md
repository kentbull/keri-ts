# Payload ownership

CESR's `Payload` interface exposes a byte length and a reopenable async reader.
`collectPayload(payload, limit)` is the explicit bounded materialization boundary.
`MemoryPayloadSink` copies awaited writes into fixed-size slabs under its byte
limit. Neither interface depends on a filesystem or database.

`OwnedPayload` adds explicit `discard()` to the read-only payload view. Every
sink returns an owner. Memory disposal releases its slabs; file disposal removes
its file. Views become invalid when their owner is discarded.

`PayloadStore` stages files using private permissions and generated IDs. Each
write must be awaited; a sink rejects concurrent operations instead of growing
an internal write queue. It handles partial writes and closes its descriptor on
completion or abort. Cancellation waits for the current bounded file operation
to settle before cleanup.

The ownership sequence is:

1. `store.stage(maxBytes, signal)` returns an unfinished sink owned by the caller.
2. `sink.finish()` flushes and closes the file, transferring ownership to the
   returned `FilePayload`. The caller must promote or discard that result.
3. `payload.promote()` atomically moves the file into the store's object directory.
   Its generated ID can then be retained and reopened with `store.open(id)`.
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

This module does not publish database references, sweep orphan files, or claim a
transaction spanning file promotion and LMDB. Those operations require explicit
storage ownership and crash recovery. It does not modify KERIpy-readable tables
such as `.essrs` or mailbox `msgs.`. Decryption, verification, and the choice to
retain ciphertext or plaintext belong to runtime consumers.
