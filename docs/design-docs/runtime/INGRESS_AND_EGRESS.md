# Runtime input, output and ownership

[ADR-0012](../../adr/adr-0012-progressive-nested-parser.md) requires buffered
complete-enclosure decoding. [ADR-0013](../../adr/adr-0013-simple-component-flows.md)
requires concrete component flows without application accounting. ResourcePolicy,
its errors, reservations and constructor plumbing are removed. No compatibility
policy, renamed ledger or queue/client/listener quota belongs here. A necessary
private socket constraint requires production evidence; use native backpressure.
The [transport plan](../../plans/runtime/TRANSPORT_PLAN.md) owns unfinished cue
ownership, general Reactor-gate removal, shared worker driving and qualification.
These architecture tasks remain incomplete.

One runtime serves a Habery or command invocation. Provider storage is selected
with `enableMailboxStore` or an injected Mailboxer; there is no host mode.
RuntimeServices contains only the actual clock and HTTP client. Baser, Habery,
Reactor, CLI and client constructors carry no shared accounting options.

`runtime.vdr` is the existing legacy Regery with its concrete Reger, Tevery and
Verifier; `runtime.acdc` is the independent v2 Regery. Both are null when a readonly
Habery receives no injected store/manager. Composition supplies the actual Tevery,
Verifier and v2 registry to Reactor. Dispatch borrows the concrete processors and
never discovers them through a runtime or probes for optional processor methods.
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

`Reactor.settle(frame, options, consume)` currently serializes dispatch, an
optional escrow pass and cue consumption. Background escrow/cue turns use that
same state guard. Waiting operations retain order and leave the wait set on
cancellation. The active turn joins child cleanup before granting the next waiter.
There is no configured waiter/source quota. A guarded consumer must not reenter
Reactor. Removing this general callback gate requires moving remaining concrete
cue work first; ledger deletion alone does not make concurrent mutation safe.
Network work runs outside guarded interpretation/signing/routing where callers
already transfer to delivery; remaining ownership work must preserve that ordering.

Queued ingress is an ordinary private `Deck<Uint8Array>`. `ingest` copies producer
bytes before publication; copy failure publishes nothing. `processOnce` pulls
records and processes them without shared/local byte credit, generation tokens or
capacity retry. Failed processing does not reinsert its record. `clearIngress`
discards queued records, while an active input operation owns its real cleanup.
Runtime explicit close and scope exit clear queued ingress and cues.

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
Cues and query-reply batches are ordinary records in Decks. `Hab.interpretCue` and
`processCuesIter` interpret semantics; source removal follows successful transfer.
Preparation failure preserves the source. Each consumer sequences interpretation,
publication and source removal directly, without prepareCueEmission callbacks.
Composition routes query, stream and reply cues to their concrete owners.
CueSink and its optional hooks/root adapters are deleted. Network output runs
outside the guarded routing turn. A pass consumes its initial extent, so newly appended
work waits for the next pass. A cue with no emission is still consumed.

Respondant owns lazy reply iterators, routing snapshots, once-signed packets and
retry progress directly. CueDelivery and DirectReplyDelivery are deleted; no
publication callback runs through a batch wrapper. HTTP openReply/enqueueReply
interpret the complete correlation batch before publishing either destination and
then take its records. Failed second-TSN interpretation leaves the pair pending.
The HTTP reader and outbound delivery consume the same signed emissions independently;
queue publication does not open replay. Actual cursor cleanup runs once, even if it
fails, and active transport joins before stores close. RuntimeDeliveries is deleted;
QueryCoordinator owns both deferred requests and signed query packets. Construction
supplies its actual Reactor and clock/HTTP services; query code never receives an
AgentRuntime. Its close stops production and joins response I/O before clearing
records or closing stores. Query requests always use this concrete output path;
there is no optional no-op downstream sink. Unresolved records remain deferred.
Synchronous producer preparation has no task/halt bookkeeping, raw-packet injector
or custom-emission API. The broad Reactor gate and duplicate whole-runtime driving
remain unfinished.

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
Normal scope exit may abort an unread successful response; only its exact owned
reason is suppressed. Finite workers close each response scope between jobs.

`postCesr` sends successive framed POSTs and completes each response scope before
advancing. Header mode carries CESR-ATTACHMENT; body mode streams one qualified
frame. Preserve URL/path, destination, authentication and media-type retry rules.
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
AgentRuntime/Reactor dependency. `tcp-conversation.ts` composes native RX/TX
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
TX alive. End output after response drain or the existing absolute deadline;
activity must not extend it. Earlier committed replies survive later TX failure.

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

Mailbox SSE awaits each complete event's consumer before another read. Poll windows
and idle timeouts remain; EOF/timeout/cancellation discard an unterminated event.
Command-local polling resumes across habitats/endpoints using integer positions,
so one empty long poll cannot starve another proxy. Continuous sinks finish before
protocol cursor advancement. There is no durable consumer inbox/acknowledgement.

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
