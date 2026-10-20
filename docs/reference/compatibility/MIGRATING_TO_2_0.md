# Breaking changes for 2.0.0

The release changes library APIs and private storage formats. KERI/ACDC/CESR
protocol interoperability remains required. Older keri-ts API and private-store
compatibility is not provided. This inventory will be completed and checked
against published 1.0.0 before final release qualification.

## ESSR evidence

- `PayloadArchive` and `PreparedPayload` are removed from the database exports.
  Exchange evidence is stored directly in pinned-main Baser's `essrs.` table.
- `Baser.openPayloads`, archive recovery/lifecycle integration, `savePlaintext`
  and `getPlaintext` are removed. There is no automatic durable plaintext store.
- `Baser.essrs` is `CesrIoSetSuber<Texter>`; use ordinary typed `add/get/rem`.
  `pinEssrs` is removed. Synchronous `getEssrs(said)` reads accepted/escrow-owned
  evidence. Qualified values deduplicate in first-insertion order, matching main
  `424a50c03421165c5f289e07a341bd57b8d8ab78`. Identical redelivery is idempotent;
  valid alternate fragmentations append distinct members. Repeated fragments can
  lose committed bytes, and alternate representations can add bytes: incoming
  digest validity does not guarantee valid stored reconstruction. Digest and
  recipient authentication checks remain; no archive or normalization masks this
  [reference limitation](../../reports/essr/KERIPY_REPEATED_FRAGMENTS_2026-10-20.md).
- Main binds `essrs.`; pinned 1.2.14/1.3.6 Baser binds `.essrs`. Direct legacy
  LMDB compatibility is [deferred](../../plans/db/DB_PARITY_PLAN.md#deferred-legacy-lmdb-compatibility),
  with no fallback reader, migration or dual write. Legacy **wire** interoperability
  remains required. Main ESSR parity does not prove full Habery/Keeper interchangeability.
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

Public multisig send reporting uses `GroupSendResult` and `GroupMessageRef`
in place of `ProposalPublication` and `ProposalIdentity`. Signed transport inputs
and per-message delivery records are internal helpers, not package exports.
Result collections are `messages`; each reporting identity has `recipient`,
`exnSaid` (outer coordination EXN) and `payloadSaid` (the existing Multiplexor key:
v1 embedded-bundle SAID or supported v2 signed-child SAID). `deliveries` lists
completed transport destinations, not participant approval or group acceptance.
`join --said` still selects the outer EXN. Other protocol/result SAIDs retain
their existing names; this is not a global rename of proposal concepts.

Shared helpers live in `multisig-messaging.ts`. Tufa owns the affected JSON
projection and identifier display. The KERI CLI helpers for multisig, endpoint
add, registry inception and credential creation now return typed results instead
of printing their final results. Registry inception returns `RegistryResult`;
credential creation returns `IssueResult` with `creder`, `recipient`, `tel` and
`status`, replacing `CredentialCreateResult.output`. Each operation has one
optional `group` block for coordination messages, deliveries and its existing
acceptance/saved facts, even when no remote member was contacted. Tufa explicitly
projects those facts into the existing flat CLI JSON. Endpoint-role workflows
return `GroupRoleResult`; CLI helper types use `GroupEventResult` and
`EndRoleResult`. No old-name aliases are provided.

## Messenger ownership

`HTTPMessenger` is send-only and takes `(url, http, { destination, headers })`;
`send(bytes, options)` uses that endpoint. Query sending belongs to
`WitnessInquisitor`, using ordinary HTTP transmission and independent reception. Send-only HTTP no
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

The `--cesr-body-mode` CLI option, `Habery.cesrBodyMode` and its construction/open
options, `CesrBodyMode`, its default/normalizers, and `EgressOptions.bodyMode` are
removed. Init/setup no longer persist or read that preference. Choose ordinary or
stream construction explicitly: ordered signed POSTs versus one opaque PUT. Peers
receiving stream HTTP must support PUT. Queries and mailbox polling always use
ordinary signed POSTs; specialized admin/receipt endpoints keep their contracts.

## Query workflow ownership

The query command now belongs to Tufa; `keri-ts/cli` no longer exports
`queryCommand`, and `HTTPQuery` is no longer a public runtime API. Compose a
`WitnessInquisitor` sender with `KeyStateNoticer`, `LogQuerier`, `SeqNoQuerier` or
`AnchorQuerier` operations. Await `queryDo()` for accepted-state completion;
transport completion is separate. `AgentRuntime.keyStateUpdates` is removed.
Give `KeyStateNoticer` a command-owned `Deck<AgentCue>` and pass that same Deck as
`queryCues` to `runAgentRuntime`. The application cue worker transfers saved
notices once; one noticer pulls/matches/requeues them. Wire this destination before
sender/receiver startup. The first usable notice fixes the catch-up target;
queued notices are not request-correlated or freshness-filtered. Runtime pending
state covers sending, while each invoking operation owns its semantic wait.
`keyStateSaved` now means a validated, persisted remote KSN. Consumers needing
ordinary KEL acceptance must inspect accepted database state rather than treating
that remote-notice cue as a generic state-change event. A query waiting for a KSN
cannot complete from ordinary KEL ingestion alone.

Ordinary HTTP queries acknowledge intake with 204; replies arrive through normal
Respondant/Poster delivery, mailbox polling or TCP. `directQueryResponses`, the
custom HTTP query-response wait, Respondant's `openReply`/`enqueueReply`,
`Poster.canDeliver`, and
WitnessInquisitor's `processPending`/`msgDo` are removed. Run `deliverDo` for the
sender or await `deliverOnce` for a finite pass. Requests are signed for one
attempt; a failed or cancelled attempt is consumed rather than retained for retry.
The query CLI uses one ten-second deadline and fails if accepted evidence never
satisfies its workflow. It no longer performs implicit OOBI catch-up or displays
stale state as successful query completion.
