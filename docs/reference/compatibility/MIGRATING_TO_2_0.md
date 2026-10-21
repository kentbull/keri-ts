# Breaking changes for 2.0.0

This guide compares the supported npm exports and declarations of published
**cesr-ts 1.0.0, keri-ts 1.0.0 and @keri-ts/tufa 1.0.0** with the coordinated
2.0.0 preparation. Publication is deferred. Upgrade all three packages together.
No aliases, migration readers or compatibility with old keri-ts private storage
formats are provided. KERI/ACDC/CESR protocol interoperability is a separate
requirement; a package major version does not select a wire version.

## Package entrypoints

| Package       | Supported npm imports                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| cesr-ts       | `cesr-ts`                                                                                                    |
| keri-ts       | `keri-ts`, `keri-ts/runtime`, `keri-ts/db`, `keri-ts/cli`                                                    |
| @keri-ts/tufa | `@keri-ts/tufa`, `@keri-ts/tufa/runtime`, `@keri-ts/tufa/host/kernel`, `@keri-ts/tufa/http/protocol-handler` |

These entrypoint names remain available. Internal source directories have been
reorganized by responsibility; update checkout-local imports to their new owners
or use supported package imports. Do not deep-import generated npm implementation
paths. Install on Node **20.3 or newer**. The runtime graph is Tufa → KERI → CESR;
strict NodeNext consumers do not need `skipLibCheck`.

## cesr-ts: ordinary ESSR bytes

The root exports `OwnedPayload`, `PayloadSink`, `MemoryPayloadSink`, `essrRaw` and
`essrWire` are removed. Read Texter raw/qualified bytes and use ordinary resident
byte values. Shared frame serialization, counters, buffered CESR parsing and real
transport sources remain; this release does not require every transport to buffer
an entire conversation.

Weighted-threshold `Tholder.maxWeights` and `Tholder.maxSithLength` are configurable
deployment caps. Set them before concurrent processing; they are not protocol
wire maxima or application memory budgets.

## keri-ts: compose explicit protocol and I/O owners

`createAgentRuntime` now requires the HTTP client and clock explicitly:

```typescript
import { createAgentRuntime, FetchHttpClient, systemClock } from "keri-ts/runtime";

// Within an Effection Operation; hby is an already acquired Habery.
const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
```

`RuntimeServices`, `defaultRuntimeServices` and `RuntimeHttpClient` are removed,
as are `AgentRuntimeOptions.services`, `mailboxPollTransport`, and the exported
`MailboxPollTransport`/`MailboxPollTransportRequest` contracts. Supply `HttpClient`
and `RuntimeClock` to the concrete owners that need them. Mailbox polling uses
its ordinary HTTP/SSE implementation rather than an injected polling callback.

`Reactor` now takes a `ProtocolProcessor`, owns input parsing and exposes awaited
`process`/`processBytes`. Its dispatch/escrow proxies, `ingest`, `clearIngress`,
`processOnce`, `hasIngress` and background input worker are removed. Use
`runtime.protocol` for shared semantic dispatch/escrows, `runtime.exc` for exchange
work, and an input-owned `new Reactor(runtime.protocol)` when another input is
needed. `ReactorDispatchResult` becomes `ProtocolDispatchResult`. There is no global
protocol mutex. Exchange route `reconcile` and `verify` must now return synchronous
decisions; asynchronous preparation/handling must not split validation from commit.
The processor borrows a native `RegistryObserver`, not a registry-authoring manager.

`runtime.poster` is now `runtime.postman`. `Hab.processCuesIter` yields
`Uint8Array`, `Hab.interpretCue` and root/runtime `CueEmission`/`CueEmissionKind`
are removed, and `ReplayCue.messages` becomes `msgs`. Respondant takes
`(hby, postman)` and publishes via `enqueueCue`/`enqueueMsgs`; it no longer owns
reply streams, independent workers or `openReply`/`enqueueReply`. Witness ingress
and `drainWitnessCues` return completion rather than emission arrays; the input
source helper no longer takes an emission callback.

Update concrete constructors with their actual dependencies: Oobiery takes
Habery, protocol, Revery, HTTP and cues; Anchorer/Receiptor/WitnessReceiptor take
protocol/transport/time owners. Notifier takes Signator instead of Habery;
Organizer takes Baser and nullable Signator. Credential and DID helpers take
Regery directly rather than discovering it through AgentRuntime. `requireRegery`
is removed. These are borrowed collaborators, not permission to close their
stores from a subordinate operation.

## Delivery, HTTP and TCP

Poster is the queued output owner. Build signed EXNs with `createExchangeMessage`
and enqueue signed bytes with `postman.send({ src, dest, topic, msg })` or a finite
`sendStream({ src, dest, topic, msgs })`. Run/join `deliverDo` independently, normally
through `runAgentRuntime`. To observe one admission, request `{ notify: true }`
and await `wait(evt)`. Its sent/failed outcome includes actual partial deliveries;
it does not mean participant approval, group acceptance or a delivery ack.
Unobserved failures are diagnosed without retaining a retry backlog.

`Poster.sendBytes`, `sendExchange`, `sendPreparedExchange` and their route/prepared
helpers are removed, as are `ExchangeSendResult`, `RawCesrSendResult`,
`ExchangeDeliveryPreference`, `ExchangeTransport`, `sendSignedExchangeMessage`,
`directDeliveryEndpoints` and `mailboxDeliveryEndpoints`. The standalone
`sendExchangeMessage(hby, hab, http, clock, args)` returns `{ serder, deliveries }`;
its addressing field is `dest`, not `recipient`.

`HTTPMessenger(url, http, { destination, headers })` sends ordinary messages.
`TCPMessenger(url, clock, protocol?)` needs protocol only for duplex replies.
Use `messengerFrom` for ordinary delivery, or `streamMessengerFrom` for a prepared
finite stream. Ordinary `sendSource` sends constituent messages; HTTP stream
`send()` sends one opaque PUT. The peer must support that PUT contract.

The `CesrBodyMode`/`DEFAULT_CESR_BODY_MODE`/`normalizeCesrBodyMode` APIs,
`Habery.cesrBodyMode`, its construction/open options, `EgressOptions.bodyMode`
and `--cesr-body-mode` are removed. Select ordinary or stream construction
explicitly. Query/mailbox requests remain ordinary signed POSTs.

`HttpClient.request` returns `HttpResponse` with complete owned `body` bytes
after cleanup. `HttpClient.open` lends an `HttpStreamResponse.body(signal)` source
inside its Effection scope; finish or return the reader before leaving that scope.
Native Response and `HttpResponseHandle`/`fetchResponseHandle` are removed from
these contracts. `requestFrame` now requires HTTP and returns that scoped response;
`postCesr` requires HTTP and has no response-consumer callback. `postCesrMessage`
and `streamBytes` are removed. Transport failures retain `TransportError.cause`;
request-validation, consumer, cancellation and cleanup failures stay distinguishable.

`TcpConversation`, its option/receiver types, `TcpTransmission`, `converseCesrTcp`
and `streamCesrTcpConversation` are removed. TCP send/write operations now take
an explicit clock and return completion; use TCPMessenger for reply processing.
SSE helpers take `HttpStreamResponse` and an explicit clock. `MailboxPollBatch`
requires provider `eid` and no longer has `source`: local provider storage is not
a recipient-consumption loop. Use direct intake or ordinary remote HTTP/SSE
polling. `mailboxPollEndpoints` takes Hab alone.

## Query completion

`queryCommand` moves out of `keri-ts/cli` into Tufa. Compose WitnessInquisitor
with `KeyStateNoticer`, `LogQuerier`, `SeqNoQuerier` or `AnchorQuerier` and await
`queryDo()` for accepted-state completion. A successful send or HTTP 204 only
acknowledges intake; actual replies arrive through direct/mailbox/TCP processing.
`ProtocolHostPolicy.directQueryResponses` is removed.

Give KeyStateNoticer one command-owned `Deck<AgentCue>` and pass the same Deck as
`queryCues` to `runAgentRuntime` before I/O starts. `keyStateSaved` now denotes a
validated, persisted remote KSN, not ordinary KEL acceptance. The first usable
notice fixes the catch-up target; the operation then waits for accepted local
state. Tufa query uses one ten-second deadline, does not bootstrap missing OOBIs
implicitly, and fails rather than displaying stale state as completed recovery.

## Credential and multisig result contracts

KERI workflows return typed data; Tufa owns final JSON/display. Multisig/endpoint,
registry/credential and IPEX `keri-ts/cli` helpers now return results after owned
cleanup instead of printing their final success. Applications calling them must
render the result themselves.

`GroupEndpointRoleProposalResult` is replaced by `GroupRoleResult`, and
`CredentialCreateResult` by `IssueResult` (`creder`, `recipient`, `tel`, `status`
and optional group facts). Registry inception returns `RegistryResult`.
`createCredential` takes `(Regery, Reactor, Poster, options)`;
`inceptCredentialRegistry` takes `(Regery, Reactor, Poster, hab, options)`.
The local signed coordination wrapper is admitted before peer sends.

Group reporting uses `GroupSendResult` and `GroupMessageRef`. `messages` contain
`recipient`, `exnSaid` (outer coordination EXN) and `payloadSaid` (the Multiplexor
aggregation key: v1 embedded-bundle or supported v2 signed-child SAID).
`deliveries` are completed destinations, not approvals. `join --said` and
`ipex join --said` select the **outer EXN SAID**. Explicit resume works after
notification consumption and reuses the original event, anchor, contributions
and recipient wrappers; new business evidence still requires human approval.

`RegistryOptions` requires its shared `TelPublication` owner. `Registry.complete`
requires completed local TEL publication to the historical witness cohort;
local acceptance alone is insufficient. The host progresses durable publication,
and `ctel` identifies the issuer anchor. Registry/issuance results separate
acceptance, publication and credential saved state. `vc registry incept`/`vc create`
use a finite command host (`--timeout` default 60 seconds; zero reports pending).
Establishment-only operations use rotation anchors and participants' prepared keys.

`revokeCredential(Regery, Reactor, Poster, options)` requires the verified local
credential, selected registry and original issuance, reusing the original REV and
anchor on resume. Call `deliverCredentialRevocation` separately after completion
for business recipients. Results distinguish `accepted`, `publicationComplete`,
coordination `memberDeliveries` and external `deliveries`; pending work does not
write a completed export. Historical authenticated signers elect the external
sender, including after member rotation.

IPEX apply/offer/agree/grant/admit/spurn support group approval/fanout. Their typed
results separate completion, local approval, elected lead and transport. Grant
approval checks local verified credential/issuance/anchor evidence; responses
check the accepted predecessor and parties. Admit authenticates and settles grant
artifacts before signing. Zero settlement/approval timeouts report honest pending
state; `--no-wait` never bypasses authentication. `IpexAdmitResult.admit` is nullable.
No completed export is written while required credential or group evidence is pending.

`importCredentialStream(protocol, reger, bytes, clock, timeoutMs?)` returns
`{ saved, complete, unaccepted }`. Dispatch happens once; ordinary escrows settle
local dependencies after EOF. CLI `--settlement-timeout-ms` defaults to 5000.
Transport receipt alone does not mean a credential was saved.

## ESSR and private storage

`keri-ts/db` removes `PayloadArchive`, `PayloadStore`, `FilePayload` and
`FilePayloadSink`. Baser no longer has `openPayloads`, `savePlaintext`, `getPlaintext`
or `enstStaging`. `getEssrs(said)` is synchronous. No automatic durable decrypted
plaintext, file references, archive recovery or nested file staging remains.

Use `new EssrRecipient(hab).decrypt(said)` on accepted LMDB evidence. It returns
a synchronous decision; accepted `EssrMessage.body` is an authenticated,
caller-owned `Uint8Array`, without `plaintext`, a file view or disposal API.

Baser's `essrs.` is the ordinary `CesrIoSetSuber<Texter>` used by pinned KERIpy
main `c7e74ad`. Qualified values deduplicate in insertion order. Repeated fragments
can lose committed bytes and alternate representations can append bytes; incoming
digest validity does not ensure valid reconstruction. Reconstruction digest and
recipient authentication still reject damaged evidence. The
[reference limitation report](../../reports/essr/KERIPY_REPEATED_FRAGMENTS_2026-10-20.md)
explains the upstream issue. Legacy peers use a different ESSR table binding;
direct legacy LMDB interchange is deferred, while legacy wire interoperability
remains supported. ESSR table parity is not whole-Habery/Keeper interchangeability.

Old keri-ts private-store reuse is unsupported: preserve/export required protocol
material before moving to fresh stores. Manager encryption changes are now atomic
across stored secrets and AEID before live state is published; do not emulate
reencryption with separate low-level writes.

Observable database close failures now propagate for every handle. `LMDBer.env`
is a read-only getter exposing only a usable handle. After a failed close the
wrapper cannot reopen, clear storage or be reused; resolve the fault and acquire
a new owner. Confirmed repeated close is harmless. `AggregateError` can preserve
both operation and independent cleanup failures. Commands report final success
only after owned shutdown; close failure does not roll back completed mutations.
Generic `LMDBer.openExisting` remains non-creating and refuses whole-store clearing.
Baser path defaults are no longer declared on the class; pass explicit Baser
options. Tever validates state; Tevery owns input policy, cues and reply routes.

## Tufa and operator behavior

Import `VerifierAgent`, its options/result/business-validator types and
`createVerifierCueBaser`/`VerifierCueBaser` from `@keri-ts/tufa/runtime`, replacing
the keri-ts runtime application exports. `verifierRunCommand` is removed from
`keri-ts/cli`. Protocol Verifier, IPEX and accepted evidence remain in KERI.
The application owns webhook policy and workflow storage; `verifier run --once`
reports success after cue-store/runtime/Habery closure. Business refusal counts
reflect policy decisions, not protocol invalidity. Local ack/rack records mean
successful HTTP delivery after cleanup, not protocol acks or exactly-once receipts.
Tufa's existing root/runtime/host-kernel/protocol-handler imports remain available.

CLI option/configuration validation is stricter **before storage effects**:

- Bootstrap URL lists reject malformed members rather than filtering them; exact
  accepted strings and explicit empty lists retain their meaning.
- Omitted inception/rotation flags preserve file values; explicit false, zero and
  empty arrays override them. Malformed thresholds, booleans, lists, JSON sections
  and counts fail rather than being coerced. Decimal option syntax is distinct
  from CESR's hexadecimal/weighted threshold syntax.
- Agent/mailbox/resolver ports must be decimal integers in 1–65535. Timeouts reject
  blank, null, boolean and nonfinite inputs; documented zero/fractional waits remain
  valid. Challenge strength is a positive whole bit count; polling delay is positive.
- Mailbox update takes the **last consumed index**: -1 starts at the beginning,
  zero resumes after index zero. Unsafe next indices and fractions are rejected.
- Ordinary interact/rotate refuse group aliases; use multisig commands. Other
  uncoordinated signing workflows refuse groups or label raw output as a partial
  member contribution. Inception requires an unused alias.
- Init validates encryption intent, hides passcode input and does not silently
  fall back to temporary storage. Init/incept bootstrap waits for selected current
  OOBI/authentication attempts, including resumed children, and joins cleanup.
  Ordinary OOBI resolution means response processing, not acceptance of every proof.

`tufa oobi clean` selects exact pending `Baser.oobis` keys, previews and applies
through ordinary writable Baser loading. Preview deletes no selected rows but may
initialize tables and reload/clean habitat records. Missing databases fail; path
preparation may create empty directories. Complete/failed output follows close,
retaining actual completed deletions on failure. Other OOBI tables are not targets.

## Supported credential profile and deferred work

Local applications author legacy **NoBackers vcp/iss/rev** TELs. Registry
`noBackers`/`baks`/`toad` options, `Registry.noBackers` and `Registry.rotate()` are
removed. External backed vcp/vrt/bis/brv observer verification, historical quorum
checks, escrows/retry, replay and presentation remain. Autonomous backing was
rejected in [ADR-0014](../../adr/adr-0014-legacy-tel-backer-retirement.md);
issuer multisig and KEL witnessing are separate supported responsibilities.

TEL replay honors selected attachment versions exactly. QueryEnvelope retains
`gvrsn`; Reger replay APIs throw `UnsupportedTelReplayError` rather than silently
raising the output version. An iterator may emit a compatible prefix before
refusal. Whole-cue responders send nothing from an incompatible cue; TCP records
`unsupported-replay` locally and closes that connection. Signed bodies are not
rewritten and no remote refusal protocol is added.

Native-v2 rip/bup/upd CLI, wallet and lifecycle completion is
[deferred](../../plans/credentials/NATIVE_V2_ACDC_REGISTRY_ROADMAP.md).
Retained partial library/native validation tests do not establish a complete
native credential workflow. The Tufa verifier application uses legacy Reger.
Independent KERI/CESR v2 remains supported; main and legacy peer capabilities differ.
The current peer matrix and separately blocked Python CLI lanes are documented in
[protocol compatibility](KERI_V1_V2_COMPATIBILITY.md) and the
[CLI limitation report](../../reports/interop/KERIPY_MULTISIG_VCP_GENUS.md).
