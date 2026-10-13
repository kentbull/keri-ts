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
