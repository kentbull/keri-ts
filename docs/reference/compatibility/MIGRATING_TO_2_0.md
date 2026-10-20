# Breaking changes for 2.0.0

The release changes library APIs and private storage formats. KERI/ACDC/CESR
protocol interoperability remains required. Older keri-ts API and private-store
compatibility is not provided. This inventory will be completed and checked
against published 1.0.0 before final release qualification.

## ESSR evidence

- `PayloadArchive` and `PreparedPayload` are removed from the database exports.
  Exchange evidence is stored directly in LMDB's KERIpy-shaped `essrs.` table.
- `Baser.openPayloads`, archive recovery/lifecycle integration, `savePlaintext`
  and `getPlaintext` are removed. There is no automatic durable plaintext store.
- `Baser.getEssrs(said)` is synchronous and returns ordered Texters. The table
  uses ordinal keys rather than value-set operations; equal fragments at
  different positions are retained. Use the evidence operations rather than
  applying set semantics to payload bytes.
- Exchange metadata retains `gvrsn` directly, without an archive ownership record.
  Private file-reference, ownership, plaintext and nested-staging tables are gone.
- `PayloadStore`, `FilePayload`, `FilePayloadSink` and file-range views are removed.
  `EssrRecipient` takes only a hosted habitat. `decrypt(said)` synchronously reads
  accepted evidence from LMDB and returns authenticated inner `body` bytes, with
  no plaintext file or disposal API. Callers own those bytes' memory lifetime.
- CESR's unused `OwnedPayload`, `PayloadSink`, `MemoryPayloadSink`, `essrRaw` and
  `essrWire` are removed. Read ordinary Texter raw/qualified bytes directly.
  Shared frame serializers, counters, parsing and actual transport sources remain.

## Database shutdown

- Every observable LMDB close failure now propagates, including ordinary handles.
  A failed close leaves the wrapper unavailable: create a new owner after
  resolving the shutdown fault; do not reuse it or clear its storage.
- `LMDBer.env` is read-only and exposes only a usable handle. Native shutdown
  starts before asynchronous completion; retained raw handles must not be used.
- Repeated close after confirmed closure is harmless. `openExisting` still
  refuses missing storage, new tables and whole-environment clearing.
- Affected acquisition and command owners preserve operation plus cleanup errors
  in `AggregateError`; Habery attempts all owned closures before returning.
