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
- `LMDBer.env` is now a getter exposing only a usable handle. Native shutdown
  starts before asynchronous completion; retained raw handles must not be used.
- Repeated close after confirmed closure is harmless. `openExisting` still
  refuses missing storage, new tables and whole-environment clearing.
- Affected acquisition and command owners preserve operation plus cleanup errors
  in `AggregateError`; Habery attempts all owned closures before returning.

## OOBI cleanup ownership

`openOobiStore`, `OobiStore`, `OpenOobiStoreOptions` and
`PathManager.existingDirectoryPath` are removed. Use normal Baser ownership and
`Baser.oobis`; generic LMDBer `openExisting` remains available for non-creating
storage access. `tufa oobi clean` preview deletes no selected pending rows but
runs ordinary writable Baser startup, including table initialization and habitat
reload/cleanup. Missing databases fail; normal path preparation may create empty
directories. Results include `status: "complete"` only after closure, or
`status: "failed"` with completed deletions preserved.

## Multisig publication

Group command results include `proposals`, with each remote recipient's wrapper
`said` and shared `proposal` index key. The latter is the embedded-bundle SAID for
v1 wrappers or signed-child SAID for v2 wrappers. These identify coordination
evidence; delivery does not establish group acceptance. Internal publication
helpers take explicit identity, protocol and Poster owners instead of AgentRuntime.

## Messenger ownership

`HTTPMessenger` is send-only and takes `(url, http, { destination, headers })`;
`send(bytes, options)` uses that endpoint. HTTP query response intake moves to
`HTTPQuery(protocol, http, clock).query(url, bytes, options)`. Send-only HTTP no
longer requires protocol state or a clock. `TCPMessenger` takes
`(url, clock, protocol?)`; the optional protocol owner is needed only for duplex
replies. Its `send(bytes, options)` and `sendSource(source, options)` share the
existing socket implementation. Ordinary HTTP source iteration is named
`sendSource`; it splits messages into POSTs and does not mean whole-stream PUT.

Use `messengerFrom(destination, urls, http, clock, headers?)` for ordinary delivery
or `streamMessengerFrom(destination, urls, bytes, http, clock, headers?)` for a
prepared stream. `HTTPStreamMessenger.send()` sends one opaque PUT and returns an
owned `HttpResponse`; `TCPStreamMessenger.send()` uses the shared raw writer.
Construction opens no connection or storage and accepts no framing preference.
