# Runtime input, output and ownership

[ADR-0012](../../adr/adr-0012-progressive-nested-parser.md) requires buffered
complete-enclosure decoding. [ADR-0013](../../adr/adr-0013-simple-component-flows.md)
requires concrete component flows without application accounting. ResourcePolicy,
its errors, reservations and constructor plumbing are removed. No compatibility
policy, renamed ledger or queue/client/listener quota belongs here. A necessary
private socket constraint requires production evidence; use native backpressure.
Concrete cue ownership, protocol-only ProtocolProcessor serialization and shared CLI/host
workers are implemented. The [transport plan](../../plans/runtime/TRANSPORT_PLAN.md)
and [qualification plan](../../plans/qualification/QUALIFICATION_PLAN.md) retain
composed, failure/restart and installed-package evidence gates.

One runtime serves a Habery or command invocation. Provider storage is selected
with `enableMailboxStore` or an injected Mailboxer; there is no host mode.
RuntimeServices contains only the actual clock and HTTP client. Baser, Habery,
Reactor, CLI and client constructors carry no shared accounting options.

`runtime.vdr` is the existing legacy Regery with its concrete Reger, Tevery and
Verifier; `runtime.acdc` is the independent v2 Regery. Both are null when a readonly
Habery receives no injected store/manager. Composition supplies the actual Tevery,
Verifier and v2 registry to ProtocolProcessor. Dispatch borrows the concrete processors and
never discovers them through a runtime or probes for optional processor methods.
The root constructs one Revery and supplies it to Tevery and ProtocolProcessor. Tevery owns
TSN route registration, proof/state admission and Broker dependency retries; its
escrow operation advances TEL dependencies before registry and credential notices.
TEL-only Tevery needs no Revery; registering TSN routes without one fails before
registering either route. ProtocolProcessor does not name individual TSN handlers.
`AgentRuntimeOptions.reger` and `.acdc` borrow caller-owned stores/managers; shutdown
closes only defaults it acquired. A legacy borrowed Reger gets runtime-created
processors using the same cue Deck. Application workflows may reject genuine
registry absence, without repeated class assertions or a replacement service bag.

## Input and state ordering

`Reactor.process(source, options)` owns its parser iterator in an Effection
operation. Its source factory receives the input operation's abort signal.
`chunkBytes`, `streamBytes`, `fileBytes` and `socketBytes` adapt actual inputs.
Chunk sizes control I/O granularity, not message size or memory admission.
`processBytes` supplies a finite value to the same buffered parser path:

```ts
yield * reactor.process((signal) => fileBytes(path, { signal }));
```

A counted enclosure must arrive completely before synchronous decoding of its
children. Independent complete messages can be processed before connection EOF.
A following body, explicit enclosure or genuine EOF establishes completion;
temporary lack of input does not. Parent-owned nested children remain evidence
inside their parent until their semantic consumer accepts them. Parent signatures
never authenticate children, and a later malformed sibling does not roll back
previously committed messages. FrameIntake, TcpRead, custom frame channels,
progressive cursors and parser-owned staging/disposal are removed.

`ProtocolProcessor.dispatch(frame, options, kvy)` returns the processed envelope and its exact
decision, plus mailbox authorization observed before releasing protocol state.
KRAM can return accumulated threshold proofs as ordinary buffered data.
ProtocolProcessor serializes dispatch and escrow passes so async handlers cannot interleave
protocol processing. Waiting input cancellation removes the waiter; an active
owner joins handler cleanup before releasing the processor. It has no callback
executor or application-work entrypoint.

Protocol producers write to their own Deck, wired with the legacy TEL/verifier
processors at composition. Before publishing to `AgentRuntime.cues`, ProtocolProcessor
captures direct request replies. A new reservation also claims matching records
already published to the application Deck synchronously. Background cue workers cannot consume unfinished
protocol output or reserved replies. Interpretation, signing, routing and request
slot consumption belong to Hab, Respondant, QueryCoordinator and request owners.
Poster target preparation is an owned operation that uses the shared codec before
transport. One complete v2 body/genus becomes a signed `/fwd` body-digest envelope
with an independent nested payload; legacy traffic retains its pathed-embed shape.
Qualified CESR selectors are parsed before body construction. Respondant publishes
its interpreted source before consuming the cue; Poster owns target preparation
and per-attempt forwarding construction. Other producers publish
signed messages with Poster.send. Network waits happen only in Poster execution.

Queued ingress is an ordinary private `Deck<Uint8Array>`. `ingest` copies producer
bytes before publication; copy failure publishes nothing. `processOnce` pulls
records and processes them without shared/local byte credit, generation tokens or
capacity retry. Failed processing does not reinsert its record. `clearIngress`
discards queued records, while an active input operation owns its real cleanup.
Runtime explicit close and scope exit clear queued ingress and cues.

## Host workers and finite commands

runAgentRuntime composes the existing component workers and suspends under their
supervision. runAgentRuntimeUntil uses those same workers until its committed-state
predicate succeeds or a caller-owned elapsed deadline expires, then joins them
before returning or throwing. Commands choose their actual deadline and whether
mailbox polling is needed; no max-turn count estimates elapsed work. A blocked
HTTP/mailbox worker does not serialize unrelated ingress or escrow progress.
Actual cleanup failure still reaches the caller after convergence or cancellation.
Poster receives its Habery, optional provider store (`mbx`), explicit receive
capability and RuntimeServices as required constructor arguments. A null store or
receive capability expresses actual absence. `ensureOpen()` guards admission and
completion waiting; producers preflight only before constructing messages or
opening a direct response, rather than repeating a check around already-built work.

Poster.deliverDo is an independent host worker, separate from QueryCoordinator's
delivery/response loop. HTTP and witness ingress publish outbound work without
running Poster; the direct request response remains owned by that request.
Standalone Poster callers start and join a worker explicitly before observing
delivery completion. Tests for a finite delivery may invoke Poster.process.
Challenge verification uses the same host workers while its command loop observes
accepted responses and an elapsed deadline. It joins them before marking a match
or reporting a missing response, so an empty mailbox wait can be retried cleanly.
The did:keri CLI likewise owns introduction workers through an elapsed wait. Its
shared resolver only projects accepted Habery/Regery state. HTTP requests queue
introductions and observe the existing host's convergence; they never start a
second set of workers. Both entry points finish all supplied introductions before
projection rather than counting runtime turns or stopping at the first known key.

Serial whole-runtime and finite mailbox turn APIs are removed. Phase-specific
unit tests call actual component operations; convergence tests observe accepted
state while the host workers run. Mailbox polling has one worker per remote
endpoint, with separate request-open and SSE read deadlines. It has no command-
local turn budget, resume index or no-op configuration hook. The consumer finishes
before the remote cursor advances or another event is read. Final composed
qualification remains required.

Local endpoint commands and witness/mailbox operators submit their exact signed
records through settleRuntimeIngress and verify accepted state. This is protocol
intake, not a reason to drive OOBI, mailbox, query or delivery workers. Host operators
establish their required endpoint state before entering the kernel. The removed
seedHabs loop supplied no records; it merely pumped the whole runtime per Hab.

The HTTP kernel owns serviceHab/hostedPrefixes once and lends only the runtime to
its actual TCP companion. All supported callers configure HTTP; the unused no-HTTP
wait branch and context bundle are deleted. Mailbox hosting calls the existing
indirect host directly instead of a forwarding-only role wrapper. Agent selection
still validates its explicit hosted controllers, and witness/mailbox startup still
reconciles every required signed location/role before listening.

## Actual cancellation and cleanup

Acquire actual source/socket/store owners before their work children. Cancellation
aborts pending I/O, joins work and returns its iterator before releasing the
underlying owner. Ordinary frames, cues and route records need no synthetic lease.
`abortable` adapts Promise leaves at actual asynchronous edges. Register cleanup
before starting work so a late independent failure remains observable during halt.
A bare yielding finally can join a Promise while losing its error during teardown.

External input abort must stop waiting protocol turns and active consumers as well
as the byte source. Register the watcher before checking its state. Check before
pulls and after results, before treating done as EOF or dispatching another frame.
DispatchOptions contains protocol choices; IngressOptions adds input lifetime.

Suppress only the operation's exact owned cancellation reason and failures already
reported by that invocation. Foreign AbortErrors remain failures. Preserve a single
error's identity and aggregate distinct read/consumer/cleanup failures. Readers
cancel once, join that Promise and always attempt lock release. Unacquired request
or response bodies must expose cleanup failure too. Runtime shutdown joins output
before closing owned stores. Scoped checks do not replace composed qualification.

## Cue and query ownership

Protocol owners write within their transactions and publish cues after commit.
Cues and query-reply batches are ordinary records in Decks. Hab.processCuesIter
constructs raw wire; Respondant removes its source after successful publication.
Preparation failure preserves the source. Each consumer sequences interpretation,
publication and source removal directly, without construction callbacks.
Composition routes query, stream and reply cues to their concrete owners.
CueSink and its optional hooks/root adapters are deleted. Network output runs
in their concrete delivery operations. A pass consumes its initial extent, so newly appended
work waits for the next pass. A cue with no emission is still consumed.

Respondant fully constructs local KEL/TEL replay messages and correlated TSN
pairs before atomic queue publication and source removal. Hab.processCuesIter
returns raw wire; typed cue kin values route other work directly. HTTP openReply
publishes independent response and delivery consumers only after complete
construction. A failed second TSN leaves the pair pending and unpublished.
Poster owns endpoint selection, forwarding construction, sequential target loops,
active I/O and joined cleanup. Every evts record is one signed source message.
Observed refusals attempt remaining targets, retain the whole event in failures,
and allow later FIFO events to proceed. No automatic retry occurs. Explicit
retry(evt) creates a fresh admission from the same signed source bytes, using
current endpoints and fresh outer forwarding material; prior successes may be
repeated. discard(evt) removes failed work. Unknown construction, storage, parser
and cleanup errors are retained/reported and propagate. Failures are process-local,
excluded from pending/idle state, and cleared on shutdown after I/O joins.
Concrete native network failures are TransportError values retaining their causes.
Poster contains those errors only around network execution, attempts remaining
targets and completes failed waiters. Unexpected construction, source, parser and
cleanup failures remain visible. The [cue delivery refactor](../../plans/runtime/cue-delivery-refactor.md)
records the source references and qualification boundaries.

Poster.send accepts src, dest, topic and signed msg bytes, with optional delivery
preference and same-socket replies. It copies msg on admission and returns a fresh
event identity. Callers needing an outcome opt into notify and wait on that exact
identity, or consume its published cue. A repeated signed message cannot inherit
an older success. Outcomes contain kin sent/failed, evt and completed deliveries;
failed outcomes also retain the error. Missing routes and observed HTTP refusals
produce failed outcomes; unexpected construction, parser, storage and cleanup
failures also propagate to the owner. Existing direct-target stop-on-refusal and
mailbox multi-target behavior remain unchanged in this phase.

Only one waiter may observe an event. Cancelling it drops that observation and any
unconsumed outcome, without withdrawing shared delivery. A published outcome does
not retain a separate observer registration. Outcome cues are consumable output;
queued and active work alone determine hasPending. Whole failed events are not yet
retained in a separate failures queue and there is no new retry/discard API.

Exchange construction and signing live in exchange-messaging.ts. Producers call
createExchangeMessage before publishing; the standalone sendExchangeMessage helper
accepts dest and owns the same queue/worker/wait lifecycle. Poster.sendBytes,
sendExchange and sendPreparedExchange and their old result types are removed.
RuntimeDeliveries is deleted;
QueryCoordinator owns both deferred requests and signed query packets. Construction
supplies its actual Reactor and clock/HTTP services; query code never receives an
AgentRuntime. Its close stops production and joins response I/O before clearing
records or closing stores. Query requests always use this concrete output path;
there is no optional no-op downstream sink. Unresolved records remain deferred.
Synchronous producer preparation has no task/halt bookkeeping, raw-packet injector
or custom-emission API. Reactor has no general application gate, and commands
use the host workers described above.

Anchorer selects its optional shared protocol processor and transport services at
construction; its escrow passes receive no parent runtime. Receiptor uses a
borrowed Reactor or creates a protocol processor over the caller's existing
Habery. It does not construct AgentRuntime, unrelated registry/notification
stores or background workers. Receipt intake still runs verification and escrows;
HTTP and TCP success require the selected witness's persisted signature for the
requested event. GET returns false without matching accepted proof, including a
sequence/digest mismatch. Complementary fanout uses only verified indexed witness
signatures read from wigs; raw response proof and unrelated signer receipts do not
establish completion or enter fanout.
Use the requested accepted event's witness list for retrieval, proof indexes and
cached completion; later witness replacements cannot reinterpret older proof.
Raw witness/Poster sends construct TCPMessenger with the shared protocol processor and clock, while transport retains native
socket ownership. Every actual HTTP/TCP operation joins cleanup before returning.

QueryCoordinator owns a private ordinary Deck of QueryRequest records. Its
inspection surface exposes length/empty/peekHead. The selected local signer is
resolved at consumption; missing signers stay pending. Signing, introductions and
endpoint selection precede source removal and preserve exact wire across retry.
Failed/cancelled drains retain their head, unresolved records rotate, and new work
waits for the next finite pass. Close joins active consumption before clearing.
Continuations prepare against committed state without a parent runtime callback.
OOBI completion waits for accepted resolution and ingress/query/escrow dependencies;
it does not require background receipt delivery to a static OOBI server. Active
transport still aborts and joins during runtime close.

QueryReplies correlates exact requesting SAIDs before background consumption.
These reservations are correlation records, not capacity leases. A response owner
peeks the ordered batch, prepares/publishes its concrete output synchronously, then
takes the correlation records. QueryReply executes no destination callback. Only the final
query controls an HTTP response; earlier authorized replies transfer to ordinary
delivery. Duplicate requests can iterate the same readonly replay reference.
Authorization uses the exact frame signatures and current dispatch decision; an
older matching cue cannot override sender refusal. Final TSN pairs transfer
atomically before correlation removal. Missing routes permit response-only output.

Poster snapshots sender, recipient, URLs and body mode, then prepares a signed
introduction/forwarded request or performs the local mailbox transaction. Prepared
sending consumes ordinary wire without habitat/DB access. Local stored delivery
requires completed body/topic publication in one transaction; raw deduplication
must preserve topic order. There is no sender outbox, durable target retry sidecar,
unsupported acknowledgement or claim that transport proves remote acceptance.

## HTTP ownership

HTTP upload, fetch and response scopes share the actual request controller.
RequestInit.signal retains its reason through headers and body consumption.
Pre-aborted requests acquire no fetch. Only the owner's header timeout becomes
mailbox null; a later deadline cannot relabel earlier external cancellation.
Caller-owned response scopes may abort an unread response; only their exact owned
reason is suppressed. Ordinary CESR sends drain successful response bodies through
EOF before reporting completion. Bounded QueryCoordinator/SSE consumers keep
their explicit response lifetime. Finite workers join each response scope between jobs.

`postCesr` sends successive framed POSTs and completes each response scope before
advancing. Success headers alone do not establish completion: Content-Length or
chunked truncation fails the attempt. Redirects are refused without following or
replaying the application message. Native fetch/body-read failures retain their
original causes in TransportError; injected client, parser/source and genuine
cleanup failures retain their own identity. Header mode carries CESR-ATTACHMENT;
body mode streams one qualified frame. Preserve URL/path, destination, authentication
and supported media-type negotiation within one attempt.
KERIpy 714 HTTPStreamMessenger instead uses one bulk PUT to `/`; matching class
names does not justify changing the supported POST contract.

Finite documents and receipt proofs keep whole-document semantics, full validation
and joined cancellation. Generic ingress appends its separately encoded attachment
header to body bytes. There is no HTTP/header/document/diagnostic byte ceiling or
local accounting refusal. Positive peer HTTP refusals remain separate from source,
fetch, parser, storage and cleanup failures. Diagnostic text reads through EOF or
cancellation using incremental UTF-8 decoding. Request-local reply readers retain
independent iterator ownership through response consumption and cancellation.

## TCP ownership

`openTcpConnection` lends an actual paused socket, close completion and connection
signal. It starts no parser or receive callback. Lower byte transport has no
AgentRuntime/Reactor dependency. `TCPMessenger` composes native RX/TX
siblings and owns parsing/dispatch at the application layer. Standalone sends
remain transmit-only; explicit reply mode enables same-socket conversations.
HTTP/HTTPS priority, TCP fallback and mailbox/direct routing remain unchanged.

`socketBytes` acquires exclusive binary readable ownership on first pull. It
allows one pending pull and returns independent allocations, normally at most
64 KiB. Abort/failure/early return destroy and join close; genuine receive EOF
releases only read ownership. Connection owners observe socket errors before
acquisition and after EOF. Native buffering is not an RSS or whole-message bound.

Each write callback and required native drain completes before the next source
pull. Output checks cancellation after pull before writing or treating done as
EOF. Directional failure stops its sibling and joins cleanup. Receive EOF leaves
TX alive. Transmit-only output completes at the local end callback and then joins
connection cleanup; it does not require peer EOF or remote protocol acceptance.
Later receive reset cannot downgrade completed local output. Duplex conversations
still process receive EOF and preserve accepted replies before later TX failure.
The existing absolute deadline covers local end and, for duplex only, peer close;
activity does not extend it. Native socket/connect/write errors retain their causes
in TransportError. Source and distinct cleanup errors must not become peer failures.

Tufa tracks actual accepted handles and connection scopes through close, without
connection-count quotas, shared allowances or busy/drop callbacks. Stopping rejects
new handles. Each connection owns one pending parser pull plus deferred-query
readiness, allowing replies without another inbound message. Intrinsic wire and
recognized peer failures close/report that connection. Infrastructure, invariant
and cleanup failures reach the host owner. Shutdown stops acceptance, joins
reads/dispatch/output and socket/listener close, then releases stores.

`conversationDrained` means local TX plus processed RX EOF. `processedFrames`
counts dispatch attempts, including ignored/rejected/escrowed input. Lower output
reports only `transmitted`. Verified persisted receipts and protocol decisions
establish acceptance; local drain or HTTP status cannot substitute for them.

## Replay and database lifetime

AgentRuntime borrows its Habery and injected stores. Default v2 Regery/RegBaser,
legacy TEL, Noter and optional provider Mailboxer are scope-owned. Readonly Haberies
create neither default registry store. IPEX borrows the v2 RegistryStore rather
than opening another handle. Acquisition owns failed/unreturned stores before
reopen can suspend. Explicit close followed by scope exit is harmless; injected
stores remain caller-owned. Separate v1/v2 environments remain distinct.

KEL replay captures prefix/FEL ranges without depth, message-size or proof-row
policies. Cyclic delegation chains still fail. Later events do not extend captured
horizons; current proofs hydrate on consumption, and each cursor closes before
yield. Witness SN replay preserves insertion-proem order and excludes later FEL
ordinals. Missing selectors and corrupt rows retain their existing outcomes;
unsupported numeric representation raises RangeError, not a capacity refusal.

ReplyStreams tracks real lazy readers until EOF/cancellation/shutdown before store
close. Each pull yields one source message without splitting. openNonEmpty primes
one nonempty message; empty sources close before returning null. Iterator/acquisition/
cleanup failures propagate. Finite witness wrappers copy messages and close their
source iterator; the source form consumes emissions individually without an aggregate.

Endpoint proof reconstruction uses typed stored bodies, canonical transferable
prefix/SN/digest ordering and original seals. Existing compact SN keys are padded
for ordering without rewriting tables. Exactly one cigar contributes a couple;
no authenticators fails rather than publishing an unproved body. The serializer
validates actual proof framing without a group-count/work cap.

## Mailbox, OOBI and DID

Mailbox polling runs one worker per remote endpoint with actual request-open and
SSE read deadlines. One empty long poll cannot serialize another endpoint's work.
Each complete event's consumer finishes before another read or cursor advancement;
EOF/timeout/cancellation discard an unterminated event. There is no finite polling
turn, command-local resume index or durable consumer inbox/acknowledgement.

Provider SSE reads only on demand and closes each LMDB iterator before suspension.
One demanded row is framed in 64 KiB output chunks without rejecting larger rows.
Query responses own nested readers; direct responses are tracked by the director.
Close wakes pending polls and rejects new direct/query responses before stores
close. Keep exact nonnegative safe cursor ordinals and unmatched correlation order.

OOBI CESR media types enter Reactor's buffered parser directly. Independent complete
events can commit before response EOF. One actual job guard retains the original
queue row until terminal result and outlives joined body/fetch/parser cleanup.
Partial failure clears in-flight state, preserving retry ownership and accepted
events. Errors propagate without a local busy/limit requeue path. Resolved means
retrieval completion, not independent acceptance of every incoming event.
JSON/schema documents collect and validate without admission credit or a size cap.
Authenticator performs status-only GETs; cleanup failure cannot publish successful
authorization. It accepts actual clock/HTTP services without Baser policy identity.

DID resolution waits for genuine KERI/VDR EOF and escrow processing before fetching
hosted JSON or returning a document. Full generated-versus-hosted comparison remains
required. Only default native fetch-header TypeError and non-ok HTTP status permit
the existing alternate URL; injected TypeError and body/parser/storage/cancellation
failures propagate. Failed refusal cleanup prevents fallback. Native HTTP fallback
is not strict TLS qualification. Finite collection has no byte/stream allowance.

Static artifacts own regular files directly. Demand causes each 64 KiB read; capture
the opened extent, ignore later growth, reject truncation and join close. This is
not a content snapshot. Request abort owns acquisition; response/host shutdown owns
later reads. Default handlers are owned, injected handlers borrowed. Dynamic did.json
uses JSON-only construction without CESR replay; broader lazy generation/export is
deferred. Post-header body failure terminates the body and reports its original error.

### Shared protocol processing and input owners

ProtocolProcessor holds the serialized protocol turn, captures QueryReplies before
application cue publication, and advances the shared durable escrows. Reactor owns
queued/source parsing and an independent Kevery. Each receiving TCP operation also
creates its own Kevery over the same Baser cache and configured policy. Shared
Revery/Exchanger/TEL owners remain long-lived; input construction never replaces
semantic reply registrations. Protocol processing calls the existing dispatchEnvelope
implementation directly. No callback executor or additional receiver facade exists.

Host composition exposes actual `protocol`, `replies` and `exc` owners. HTTP/TCP
request slots borrow `replies`; IPEX workflows observe `exc`. Poster borrows the
shared ProtocolProcessor rather than Reactor. Minimal standalone input composition
uses createProtocolProcessor over the caller's existing Habery, opening no stores
or background workers. Reactor has no dispatch, escrow or semantic-handler proxies.

TCPMessenger owns each TCP attempt, including concurrent receive parsing and its
own Kevery when receive capability is supplied. Its required constructor receives
the shared protocol processor (or explicit null for transmit-only) and clock.
`send` adapts finite bytes to `stream`; no stream subclass or nested message queue
exists. Explicit `replies` selects processed receive EOF. Socket/drain/cleanup facts
remain in the lower TCP owner. The old conversation and prepared-target application
wrappers are removed; QueryCoordinator and Poster retain separate queue policies.
