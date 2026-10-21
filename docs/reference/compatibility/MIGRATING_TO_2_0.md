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

Initialization and inception now complete selected introduction/authentication
work, including resumed records and multi-OOBI children, without waiting for whole
agent quiescence. Historical failures do not fail new work; a fresh authentication
refusal is not hidden by old authorization. Ordinary OOBI resolution means the
response was processed, not that every contained proof was accepted. Protocol
escrows remain available for their owners to retry; later operations must check
their required accepted evidence. Authentication retains its controller-state and
authorization requirements, with unfinished attempts reaching the finite deadline. Both commands print final success only after owned stores close.

## Host, mailbox and challenge inputs

Agent/mailbox ports must be decimal integers in 1–65535; zero no longer silently
selects the agent default. Malformed schema path list members are rejected.
Mailbox update takes the **last consumed** index: `-1` restarts from the first
message, `0` resumes after index zero. Fractions, values below -1 and values whose
next index cannot be represented safely are rejected.

Challenge strength must be a positive whole bit count. Verification accepts
nonnegative decimal seconds, including fractional waits; zero checks already
accepted evidence without waiting. Poll delay must be positive. Supplied blank,
null or boolean numeric values are errors; omission retains command defaults.

## Credential command validation

Credential, IPEX and verifier commands reject supplied non-string/non-boolean
options and malformed schema or recipient lists instead of casting or filtering
them. Supply decimal timeout values; blank, null, boolean and nonfinite values
are errors, while omission retains each command's default. IPEX zero/fractional
waits and positive fractional import settlement windows remain supported.
Credential JSON sections and IPEX attribute objects validate before stores open.

Endpoint, signing, query, DID and witness command adapters now reject malformed option
types before opening stores. Repeated signature/DID/OOBI/hosted-prefix lists must
contain only strings. DID resolver ports accept decimal integers, not coercible
booleans, fractional values or hexadecimal text. An explicitly empty query anchor
path is invalid rather than an instruction to query key state. Operator and
publication commands apply the same type validation: malformed entries cannot be
dropped from exchange data, cleanup flags must be booleans, and notification
counts/database dump limits must be valid decimal integers.

## Lifecycle option validation

Inception and rotation preserve file values when flags are omitted. Explicit
false, zero and empty arrays remain overrides for programmatic command callers;
rotation applies next-key defaults only after file/CLI precedence. This deliberately
differs from KERIpy main's rotation CLI default override. Malformed supplied
booleans, lists, counts and thresholds now fail before opening stores. Counts use
decimal integer syntax; thresholds retain CESR hexadecimal/weighted syntax and
Tholder's configurable limits. Null or empty thresholds are invalid supplied values.

Multisig configuration now rejects malformed member or witness entries instead
of silently removing them. Supplied null/blank/nonfinite approval timeouts fail;
omission retains the command default, and zero/fractional seconds remain valid.
Group rotation preserves file data and witness changes when flags are omitted;
explicit empty arrays override those file fields.

## CLI group command selection

Ordinary `interact` and `rotate` refuse group aliases; use `multisig interact`
and `multisig rotate`. Inception requires an unused alias. Generic EXN sends,
challenge responses, location publication, query requesters and DID binding
reject group aliases where they cannot coordinate approval; select the indicated
member/endpoint alias or supported group workflow. Raw `sign` output now labels
a group's signature as a partial member contribution.

## Multisig publication

Public multisig send reporting uses `GroupSendResult` and `GroupMessageRef`
in place of `ProposalPublication` and `ProposalIdentity`. Signed transport inputs
and per-message delivery records are internal helpers, not package exports.
Result collections are `messages`; each reporting identity has `recipient`,
`exnSaid` (outer coordination EXN) and `payloadSaid` (the existing Multiplexor key:
v1 embedded-bundle SAID or supported v2 signed-child SAID). `deliveries` lists
completed transport destinations, not participant approval or group acceptance.
`join --said` still selects the outer EXN. Explicit joins can select accepted
coordination evidence after notification consumption and reuse recorded KEL,
reply, VCP and ISS approvals without another prompt or group-event signature.
Resend reuses recorded recipient wrappers; transport completion still does not
prove group acceptance. Other protocol/result SAIDs retain
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

## Native registry intake

`ProtocolProcessor.registry` and its constructor dependency are now a borrowed
`RegistryObserver`, replacing the local `Regery` manager. AgentRuntime composes
it over the same accepted KEL and registry store, while retaining the manager's
lifecycle. RIP/BUP messages now reach native validation through ordinary ingress;
foreign pending registries recover from durable escrows without local aliases.
This does not create a credential wallet or persist disclosure openings.

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

## Native-v2 interoperability boundary

The release requires a complete Tufa native credential workflow, with Python
construction and independent verification against the execution manifest's main
pin. Python exchange/proof acceptance does not imply a persistent Python native
wallet or credential-aware multisig approval. Mixed-language ixn/rot signatures
prove KEL approval only unless business validation is independently demonstrated.
The relocated `tufa verifier run` application remains legacy-Reger based; native
protocol observers are separate from that webhook application.

Ordinary native examples and Python interop use the shared I2I/NI2I/E1E and AND/OR
operator subset. DI2I and the bounded NOT interpretation remain TypeScript-only
capabilities, not Python compatibility claims. The release plan's early live
proofs and final qualification must establish these claims before publication.
