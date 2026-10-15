# Progressive runtime ingress

`Reactor.process(source, options)` is an Effection operation. The source factory
receives the operation's abort signal and supplies bounded, independently owned
chunks. `chunkBytes`, `streamBytes`, and `fileBytes` adapt a finite value, Fetch
body, or Deno file. A file source can be consumed directly:

```ts
yield * reactor.process((signal) => fileBytes(path, { signal }));
```

`runtime.intake.frames` exposes the optional CESR Effection channel when an edge needs
to inspect each complete frame before choosing its dispatch policy. Its channel
belongs to the caller's scope. Each complete independent GenericGroup child is dispatched before the
consumer requests the next frame. Parent-owned nested children remain evidence
inside their complete parent; only its route-specific consumer may process them. A later
malformed sibling does not roll back already accepted children.

`Reactor.settle(frame, options, consume)` serializes one dispatch, an optional
escrow pass, and its cue consumer. The consumer must not recursively call a
guarded Reactor method. Input sources remain independent and backpressured;
only their shared protocol state is serialized. Background escrow/cue turns and
verifier cue consumption use the same guard. Direct calls to core processors are
outside this runtime boundary.

The default limits are eight active sources, eight waiting turns, 1,024 pending
cue references, and 8 MiB in the temporary complete-record queue. Parser byte,
attachment, and nesting limits remain independently configurable. Exhausted
admission fails with `ResourceLimitError`; it does not create an unbounded waiter
queue. The shared cue deck enforces its reference capacity for every writer;
batched insertion validates before mutating the queue. KEL/reply/TEL/credential
admission checks cue space before changing accepted state. Full-deck backpressure
retains event/reply/credential escrows and queued OOBI work for a later turn;
a batch larger than the configured capacity fails explicitly. A draining turn
remains available while admission is full. Cue consumers handle only the batch
present when their pass begins, so concurrent producers cannot grow a returned
emission array indefinitely. Replay cues retain lazy captured ranges as described
below.

Ownership is ordered with Effection resources: a source or runtime permit is
acquired before its work child, so cancellation joins that child before releasing
the permit. A frame's ESSR owner follows the same ordering. Durable exchange
storage may adopt its owner; otherwise the runtime discards it after dispatch.
`frames` lazily stages ESSR through the habitat's file archive unless its caller
supplies a sink. Ordinary frames do not open that archive.
Promise leaves must observe the supplied signal. `abortable` isolates the leaf,
aborts it, and joins its completion; resources that depend on it must be
registered before starting that leaf.
Explicit response-body cancellation registers its cleanup owner before starting
the cancellation Promise; joined late failures remain visible even during scope
cancellation. Finite request intake preserves distinct read/header and outer-body
cleanup failures. Unacquired response cleanup also propagates failure; it cannot
silently turn failed cleanup into success.
An already errored Fetch body may reject cancellation with its controller's exact
abort reason; that remains cancellation. Other cleanup errors, including foreign
AbortErrors during shutdown, propagate. Mailbox idle timeout keeps its ordinary outcome.

HTTP query replies carry the requesting query SAID. A bounded request reservation
captures matching replies before background consumption. Duplicate requests
share the same readonly replay reference. Reservations are released on response,
failure, and cancellation. Only a query at the end of the request controls the
HTTP response. Earlier queries retain ordinary reply delivery; their reserved
reply moves to guarded delivery before the reservation is released. Mailbox
authorization uses the final query frame's exact signatures and dispatch decision.
A current sender refusal prevents opening a response even when an earlier matching
query cue exists. See [v2 message admission](../exchange/MESSAGE_ADMISSION.md).

The existing delivery owner can prepare an earlier query batch without an HTTP
response consumer. This atomic queue-only transfer preserves the original slot
on capacity or preparation refusal and reserves no response stream permit. It
retains the once-interpreted wire through joined target cleanup; no-target cleanup
waits until all preparation and source ownership have transferred. Generic HTTP
uses this queued-only transfer for each earlier query authorized by its own exact
frame/dispatch; a later unrelated frame neither authorizes nor revokes that batch.
Ordinary HTTP cues use `processCuesOnce` with a per-request service habitat/sink:
query/wire, mailbox correlation and unresolved pending ownership transfer before
source removal. Network delivery and borrowed fallback consumption/cleanup run
outside Reactor. Only observed engine-created admission refusals become HTTP
capacity responses; foreign same-class source/preparation failures propagate.
Explicit endpoint absence keeps the responder’s existing best-effort no-delivery
outcome; no-target cleanup follows source transfer without a second interpretation.
Witness source intake also prepares in short guarded turns and consumes callbacks
outside Reactor. One existing delivery batch keeps the once-interpreted wire until
queued targets and joined callback cleanup both finish; queued targets own their
route. Busy preserves input. The source API collects no aggregate. Finite wrappers reserve 8 MiB output
before copies and return caller-owned snapshots bounded by that local byte ceiling
and captured cue-count capacity, including copied replay.messages. No lazy owner
escapes. Parser/callback cleanup joins before output credit releases; late iterator
and cleanup failures propagate together. Default CueDeck activation remains separate.

The generic HTTP route consumes its request body progressively and appends a
separately bounded CESR attachment header. Administrative requests still collect
an explicitly bounded 8 MiB value. `Reactor.processBytes` supplies a finite value to the same progressive source
path; it owns parsing and dispatch through an Effection operation. No shared
feed buffer or separate synchronous parser remains.

FrameIntake owns source admission, one pending parser pull and joined source/parser
cleanup. AgentRuntime constructs it and lends the same component to protocol
processing and HTTP/TCP edges. Reactor owns guarded dispatch/escrow/state turns;
its former frames method is removed. Frame ownership still crosses the existing
consume/settle boundary; storage payloads retain their valid independent lifetime.

## Socket-to-application boundary (implementation pending)

The required transport path is a bounded abortable source, one progressive parser
per connection/request, complete frames, guarded verification/storage, and owned
delivery outside the guard. HTTP body intake and Tufa TCP witness intake use the
progressive parser. Existing cue consumers can still
await network I/O under the guard. The [transport plan][transport-plan] owns closure;
duplex and composed backpressure remain unqualified.

`socketBytes` is the shared KERI runtime TCP source used by Tufa witness listeners.
It acquires exclusive binary readable-mode ownership
on first pull, returns independent backing allocations of at most 64 KiB by default,
and permits one pending pull. Do not mix data/flow readers with it. Abort, failure
and early return destroy and join socket close; genuine receive EOF releases only
read ownership, preserving the writable half. The connection owner must handle
socket errors before acquisition and after EOF, and own output drain/final close.
Before pulling, admit the connection and two bounded materialized read/copy
allocations, retaining credit through parser/source cleanup. A native-returned
view may pin pool/socket backing larger than a small configured chunk ceiling:
twice that ceiling does not cover all native backing. The host must separately
account for fixed pools, readable/native/kernel buffering and qualify its actual
configuration; this adapter supplies no full native or RSS bound.

Tufa admits paused TCP connections before creating work, with a default cap of
two admitted/closing connections and a positive shared 2 MiB logical read/copy
allowance per connection. This allowance is qualification policy, not a hard native
buffer ceiling. Reactor reserves the sole receive stream/cursor owner before the
first socket pull; two receives consume two stream permits. Native acceptance is
capped at `maxConnections + 1`: one transient refusal handle allows reporting in
Deno, whose native cap does not emit Node's `drop` event. That handle is tracked
through close and joined on shutdown, with no task/read/queue before refusal;
native/kernel pre-admission buffering remains separate from the shared ledger.
Intrinsic wire failures, policy refusals and recognized peer failures close and
report the connection; cancellation stays distinct. Source/storage/invariant and
cleanup failures reach the host owner after joined cleanup. Parser-owned source
return is not peer close. Stop acceptance, join parser/source/socket tasks, then
join listener close before closing runtime stores. Earlier accepted frames remain
durable after a later connection failure. Default mailbox/direct routing stays
unchanged; same-socket reply conversations remain separate work.

The guard protects protocol interpretation, signing, routing snapshots and local
DB side effects. Network waits and capacity waits belong outside it. Transfer a
cue only after its bounded delivery owner accepts it; saturation must retain the
original cue. Replays carry captured extents plus one admitted current message.
Borrowed frames and KRAM payload owners cannot escape their consuming scope as
lazy work. HTTP request-local replies retain their existing correlation and owner.

Each connection has a supervised receive/parser task and finite shared credit
before reads begin. Stream writes await drain before pulling another chunk.
Shutdown stops admission and joins reads, dispatch and output before sockets and
stores are released. Stream high-water marks alone do not establish these bounds.

Explicit enclosures, a following body or genuine EOF complete CESR frames;
temporary lack of input does not. A bare final frame may await more input.
Independent GenericGroup children can become usable before transfer completion;
parent-owned children remain evidence until their parent's route accepts them.

Full duplex is an explicit same-socket reply mode, separate from the preserved
mailbox/direct routing default. Receive EOF does not imply transmit failure.
Half-open sockets end output after response drain or a fixed absolute deadline
that activity cannot extend. Local write completion is not remote authentication
or durability. Failed delivery retains live ownership; restart recovery requires
a separately proven durable obligation or reconstruction path, not just a queue.

[transport-plan]: ../../plans/runtime/TRANSPORT_PLAN.md

Eligible Respondant source cues now transfer synchronously into RuntimeDeliveries
before source removal. Occupied item/byte capacity preserves the head; ineligible
custom cues keep their existing sink. QueryCoordinator observes transferred cues
only after acceptance. Packet delivery then runs outside Reactor, while failed
wire/progress remains owned. Exact preparation refusal notification separates
engine busy outcomes from foreign same-class interpretation/routing failures.
Source queries and continuation requests use synchronous `admitQuery` preparation
after item preflight, bounded raw input, 8 MiB retained wire, 1 MiB route metadata
and 24 MiB temporary preparation admission. This local input/wire policy refuses
before signing when capacity is occupied; configured input/floor limits remain
distinct. Ineligible preparation publishes nothing and preserves unresolved/custom
notify behavior. Continuation drains prepare synchronously over committed state without a parent
runtime or Reactor callback; no signing, route lookup, capacity or network wait occurs before that
admission. Source removal/observation follows transfer, and joined network work
retains the original endpoint/signature. These logical allowances leave decoded
serialization/native endpoint-row copy qualification open. Request-local HTTP/
witness response ownership, mailbox workers and the remaining stack inventory
still require their caller ports.

Pending queries are plain QueryRequest records in the coordinator's private
ordinary Deck; continuations are unbounded metadata too. No byte estimates,
reservation wrappers or configurable caps apply to these records. The top-level
query/witness list is copied; nested query values remain immutable borrows.
Failed/cancelled sends retain the head, unresolved work rotates, and close joins
active consumption before clearing. Inspection cannot mutate the queue. Actual
wire preparation and source/transport cleanup keep their separate controls; this
metadata path does not establish a shared memory bound.

## Messenger responsibilities

The release requires incremental source/sink I/O where KERIpy 714 supports it:
TCP parser/reply lifetimes, HTTP messenger ownership and mailbox SSE. Callers share
the runtime's exact services/resource policy, preserve borrowed owners and
propagate cancellation through joined cleanup. Further stack-wide adoption is deferred. GET retrieval,
SSE and non-CESR documents preserve their framing; they reuse ownership facilities
rather than being wrapped in a CESR POST. A finite collector needs a semantic
reason and enforced admission/cap, not merely a legacy byte-input API.
The [stack adoption inventory][transport-plan] marks remaining callers explicitly.

Well-known authentication is a status-only GET exception: no response body is
collected. `Authenticator` uses its Habery's exact policy and reserves a stream
plus URL/handle allowance before fetch. Busy leaves durable pending authorization
untouched. The response and pending cleanup join before credit returns; cleanup
failure cannot publish success. Native headers/buffering and durable pending-row
allocation are separate qualification boundaries.

Required reference-backed library, host and command paths follow these ownership
boundaries. Upstream finite collection remains permitted. A convenience wrapper
must preserve its declared policy and joined lifetime. Finite document/proof exceptions
retain their framing but expose an enforced ceiling, admission owner and
cancellable joined response lifetime. Document the reason at the owning API;
byte-input convenience alone does not justify buffering an entire history.
Required streaming paths account their preparation and retained results; releasing
a response reader does not release retained in-flight state. Finite introductions,
credential exports and JSON may preserve reference behavior. Their conversion to
new lazy producers or caches is deferred. Required callers preserve failure,
disconnect and shutdown ownership. Size policy, local capacity refusal, transport
failure and verified application acceptance remain distinct outcomes.

Two engines own transport work: CESR HTTP request/response scopes and an owned
TCP connection with directional I/O. Small Effection operations/resources expose
finite-message and source inputs. TCP adapters share one writer with optional owned
reply parsing; reference-backed caller qualification remains S1–9.

| KERIpy responsibility | TypeScript entry / shared engine                        |
| --------------------- | ------------------------------------------------------- |
| HTTPMessenger         | `requestFrame`; finite bytes via `postCesr`             |
| HTTPStreamMessenger   | `postCesr` source and scoped response consumer          |
| TCPMessenger          | `sendCesrTcp` / `sendCesrTcpFrame` on one owned writer  |
| TCPStreamMessenger    | `streamCesrTcp`; factory borrows bounded `Payload.open` |

Do not add aliases or inheritance merely to mirror names. Reuse existing byte
sources, serializers and response readers. A parsed frame bypasses byte parsing;
its caller retains every borrowed frame/payload owner until transport consumption
and joined cleanup finish. Byte inputs enter the same machinery through a finite
source adapter. Stream inputs use an abortable source factory or an appropriately
owned Payload, pulled only under available credit without hidden prefetch or
transfer-sized collection. Shared admission precedes source acquisition and
avoidable allocation; cancellation joins reads, writes, parsing and disposal
before releasing reservations.

HTTP `postCesr` produces successive framed **POST** requests, finishing each
response scope before advancing. Header mode sends the body with bounded
`CESR-ATTACHMENT`; body mode streams one qualified frame in that request. Neither
mode turns the whole source into one request. Preserve the resolved URL/path,
`CESR-DESTINATION`, authorization and existing media-type negotiation. KERIpy
714's HTTPStreamMessenger instead sends one bulk PUT to `/`; this is a documented
wire/API difference, not a reason to change the established POST contract.

The HTTP engine owns upload, fetch and response cleanup. Normal scope exit may
abort an unread successful response; cancellation suppresses only that controller's
exact reason, preserving foreign AbortErrors and cleanup failures. Its scoped consumer
uses one progressive parser for each applicable CESR response body. Receipt/SSE
readers retain their distinct framing contracts. TCP owns one progressive parser
per receive lifetime, optional concurrent reply consumption and directional
shutdown. Only explicit conversation policy enables same-socket duplex. Socket
fragments and temporary byte exhaustion never establish message boundaries.
Poster/Respondant choose destination and delivery policy; Reactor verifies and
mutates accepted state. Signing, routing snapshots and local DB preparation stay
in short guarded turns; independently owned network work and capacity waits do not.

Poster’s `resolveBytesRoute` snapshots sender, recipient, target URLs and body
mode. Synchronous `prepareBytesTarget` performs local mailbox writes or prepares
one signed introduction/forwarded request. `sendPreparedCesrTarget` consumes that
wire through the shared HTTP sender without habitat or DB access. Its bytes stay
caller-owned through joined cleanup. Existing `sendBytes` composes these steps;
S1–3 still owns admitted handoff, guard-free runtime callers and delivery outcomes.
An explicit finite target cap checks source backing before copying, and limits
introduction plus forwarded wire before their final concatenation. Direct wire
then has independent backing; its caller must reserve copy/preparation credit
first and retain it through joined cleanup. Decoding, signing and native replay
allocations remain separate qualification boundaries. HTTP/TCP senders return their
own expected capacity/HTTP outcomes to prepared delivery after joined cleanup.
Prepared target attempts return local complete/refused/busy; injected source,
fetch, sink and cleanup failures propagate unchanged, including foreign same-class
errors. Strict public source/frame senders throw refusal after the same cleanup.
Attempt helpers remain internal module contracts rather than runtime package exports.
The preparation facility adds no queue, automatic retry or runtime handoff.
Local stored delivery requires completed body/topic publication in one mailbox
transaction. Repeated body appearances preserve topic order and raw deduplication;
false publication cannot acknowledge delivery. This strengthens714 storeMsg's
atomicity while retaining its layout, and adds no shared-copy/native admission.

`Hab.interpretCue` synchronously borrows one cue without dequeuing. Internal
`prepareCueEmission` pre-admits input retention and 8 MiB finite output plus
24 MiB interpretation allowance before calling it. These local policy ceilings
match RuntimeDeliveries; output is checked afterward, not a decoded/capture/native
allocation bound. Lazy replay metadata/store ownership stays borrowed and unopened.
The queued source-owned floor includes its irreducible shared-batch credit;
inspect that stored amount without walking stores or opening replay.
Accept must immediately/atomically retain the owner or throw without publication;
it cannot be async, mutate the source deck or release early. Refusal preserves
input/credit; successful transfer frees the ordinary Deck slot and retains credit
until destination consumption and joined cleanup finish.

`processCuesOnce` prepares each custom/ineligible cue in a short Reactor turn,
then waits for its sink outside the guard. One scoped owner is registered before
sink resources, retaining input/output through their joined cleanup on success,
failure or cancellation. Busy preserves the source head; a pass retains its
initial count limit and eligible `admitCue` handoffs remain immediate. No queue
or stream slot is added. `QueryCoordinator.prepareEmission` observes continuations
and resolves/signs incomplete queries within that admitted preparation and final
finite output check; `sendPrepared` performs no repeated local preparation.
Actual runtime/host callers enter this drain outside an enclosing Reactor turn.
`processPending()` owns synchronous fallback signing without a parent runtime;
standalone/custom wire preparation retains caller-owned byte bounds. Default runtime
cues retain byte/item credit through transfer and joined consumer cleanup.

Prepared Poster targets preserve HTTP/HTTPS priority and select the shared TCP
engine for TCP-only endpoints, with the same introduction and forwarded bytes.
Queued cue/failed-target drains explicitly lend their runtime
for local same-socket reply intake; standalone prepared targets and public Poster
calls without that borrower drain output only. Runtime/services identity remains
exact, and transport completion never establishes remote acceptance. Public
Poster operations retain caller-owned synchronous preparation/retention bounds;
admitted CueDelivery still prepares under a short turn and sends outside it.
Poster has no durable retry store, disabled sidecar or pending-target drain.
Transport completion does not establish authenticated remote acceptance.
Invocation-local observers report actual TCP/RX capacity refusals so busy retains
existing work before socket acquisition. Foreign failures and raw peer errors
propagate with original identity; this adds no transport retry taxonomy.

RuntimeDeliveries retains query requests, cue cursors and prepared failed packets
on the existing eight-item queue. Cue output still retains 8 MiB plus source
credit. Route metadata and prepared packets are ordinary records, with no
reservation/release protocol or target-preparation ceiling. Direct packets borrow
the supplied wire; the cursor owns and closes its actual replay iterator. A bounded pass
advances one target per cue. Only the observed exact HTTP refusal may transfer
a failed packet into another admitted slot; otherwise its cursor stays put.
Other targets then progress while the exact failed wire remains pending.
Queue retirement reports local owner progress, not durable transfer/acceptance.
Synchronous cursor-finalization failure propagates after every independent cleanup
attempt and credit release; the retired owner never repeats transport/cleanup.
Actual Respondant/HTTP/witness cue adoption remains the next S1–3 unit.

Cue routing resolves once and passes the ordinary RawCesrRoute to delivery.
Resolution failures propagate before source removal. An empty route retires the
cue without sending; a populated route preserves target order. The delivery
cursor owns actual iterator cleanup, with no route reservation or release API.
The other accounting described above remains scheduled for removal.

Completion records must distinguish local transmission drain, HTTP success,
verified protocol replies and durable application acceptance. An HTTP status or
socket drain proves only its own boundary. Consumers report protocol decisions;
transport must not infer them, swallow infrastructure/invariant failures or turn
cancellation into ordinary success. No extra queues or scheduling are implied.

## Runtime store ownership

AgentRuntime borrows its Habery, injected `acdc.rgy` manager and injected VDR services.
The default v2 `Regery` owns one `RegBaser`; `vdr.reger/rgy` retain their legacy
owner and path. IPEX borrows the v2 manager's `RegistryStore`, without another handle.
Readonly Habery construction creates neither default store. A writable Habery
without an injected store acquires a default in the current Effection scope;
explicit ownership flags govern runtime.close(). Scope exit also joins database
close and removes temporary stores, including failed construction and cancellation.
Runtime-created notification and provider-mailbox stores are scope-owned before
reopen can suspend. Acquisition failure, cancellation and explicit shutdown join
`close(hby.temp)`, clearing temporary paths while retaining persistent rows.
Injected stores stay caller-owned; standalone opening helpers retain their caller
lifecycle contract. Runtime output closes before its borrowed store owners.

Explicit close followed by scope exit is harmless. The v2 manager factory owns
acquisition cleanup until it transfers the manager, including alias-load failure.
Reactor retries named registry escrows before IPEX; automatic foreign `rip/bup`
wire dispatch remains a separate intake responsibility.
A finite call scope separates acquisition cancellation from the resource provider,
so joined factory cleanup cannot resume the provider with an untransferred value.

## Replay output ownership

KEL `replay` cues and `CueEmission.messages` are reopenable iterables of complete,
finite messages. `Baser.replay` captures prefix/first-seen ranges, including at
most 32 delegators by default, and releases each LMDB cursor before yielding an
event. Its default 8 MiB event limit is admission policy, not a KERI wire limit.
Later accepted events do not extend a captured replay; stored proofs are read
when that replay is consumed. Its frozen `CapturedKelReplay` exposes only captured
ranges and the message ceiling for cue admission; the Baser stays borrowed and
must remain open. Taking/fanning out the cue retains its metadata credit until
final consumption and joined cleanup. Inspection never opens the event iterator.
Other replay sources and capture-time allocations remain separate admission work.

`ReplyStreams` owns up to eight live HTTP replies by default. Each pull copies at
most 64 KiB from one event; transport cancellation or runtime closure releases
the iterator and event. The response lifetime is independent of ingress: Deno's
legacy request signal aborts when its handler returns. If request cancellation wins
before response transfer, ingress joins its task then cancels the published body
outside status mapping; foreign source/fetch/cleanup failures remain failures.
No background task or whole-replay array is needed for these synchronous database readers.

`QueryCoordinator` retains a pending request until delivery succeeds; failure
leaves it available for retry. Concurrent drains cannot send the same head, and newly appended work
waits for the next bounded pass.

Finite `cloneEvtMsg` body reads use native row-size preflight before owned
materialization. Evidence fragments are admitted before retaining each attachment
and allocating the final event buffer. HTTP replay reserves eight event-size
allowances plus one output chunk before iterator acquisition, covering cooperating
native/body/decoded/proof/reconstruction copies through source cleanup. This is
conservative policy requiring final memory qualification, not an exact RSS ceiling.
Aggregate replay length is not collected or capped; ordinary single-event bytes
and concurrent HTTP replies remain independently bounded. Other finite callers
of `cloneEvtMsg` without a limit retain their existing allocation behavior.

## Witness source intake

`processWitnessIngressSource` owns one Reactor parser and settles each frame,
consuming witness emissions individually without an aggregate result. Its callback
borrows each emission under the current guarded frame lifetime; retained work needs
independent admitted ownership transfer, and lazy input owners cannot escape.
The finite `processWitnessIngress` wrapper keeps its collected result and chunk cap;
`/receipts` retains `local: true, deliver: false`. Source cancellation joins parser
and producer cleanup. Default responder delivery still runs under the guard until
bounded handoff adoption. Tufa TCP listeners compose this source with paused,
bounded connection admission and joined parser/socket shutdown.

## Witness and exchange output

`ReplyStreams.openNonEmpty` reserves the ordinary response owner before priming
one bounded nonempty event. It returns null only after empty-source cleanup;
cleanup/acquisition failures propagate. Primed bytes remain inside that same
owner through transport consumption, cancellation or runtime close, including
failed stream publication. No external peek wrapper or second stream slot is
required. Ordinary `open` retains its first-pull behavior. This prerequisite
does not itself port OOBI producers or qualify their pre-yield allocations.

Witness `GET /query?typ=kel` returns a lazy source through shared ReplyStreams.
Without `sn`, capture contains only the target's FEL extent, never delegator logs.
With `sn`, it retains KEL sequence/duplicate order and captures final KEL/FEL
horizons. Each duplicate is sought by its physical insertion proem, so deleted
earlier rows do not shift the checkpoint and buckets are not rescanned. Later accepted duplicates at an old sequence are excluded by their
new FEL ordinals; existing index/proof metadata is consumed at read time, not
frozen as a proof snapshot. Each cursor closes before finite event hydration/yield.
The source uses the response's configured message ceiling for native body preflight.
Response credit precedes iterator acquisition and remains through EOF/cancel/runtime
close; no transfer-sized event array is retained. Pre-header busy refusal is 503,
configured-limit refusal 413; later read failures error the response stream.
Existing missing-selector/SN 400, unknown-target 200-empty and TEL 501 remain.
SN reconstruction propagates failures; no-SN uses the existing corrupt-record skip
path, whose broad proof-reconstruction catch still requires phase 5 qualification.
Native selected KEL duplicate-row and proof-row/copy pre-allocation admission
remain open. Frozen 714 QueryEnd collects bytes;
this lazy path is a qualified TS integration. Its SN path always clones with `fn=0`;
TS preserves its existing actual FEL ordinal, so SN replay is not claimed byte parity.

Signed exchanges and generic HTTP witness delivery use the same progressive
sender as forwarding. Witness authorization is preserved across content-type
retries; caller headers cannot replace CESR framing or destination metadata.
Generic witness sends borrow explicit runtime services; runtime delegation passes
its own services through this seam. Standalone callers may use the shared default.
TCP finite/source sending shares `sendCesrTcp`/`streamCesrTcp`. One stream slot
and two bounded chunk allowances precede socket and abortable factory acquisition;
finite input additionally charges its retained backing. The allowances cover one
producer chunk and a transport copy; finite input is copied into bounded backing.
Factories must observe abort, yield immutable backing within the configured ceiling,
and join cleanup on iterator return. Their pre-yield allocations remain their responsibility.
Each write callback and any required drain settle before the next source pull.
Source cleanup, write callbacks and final socket close join before credit release;
cleanup/infrastructure failures propagate. Native pools/socket/kernel residency is separate.
Connection timeout is separate from the absolute, non-refreshing end/close deadline,
which starts after source EOF. Active aggregate transfers have no total-duration cap.
The default waits for peer close after local output end, preserving finite witness policy.
The result describes local transmission, never authenticated remote acceptance.
`sendCesrTcpFrame` borrows an already admitted tree directly through `framePayload`,
without reparsing, adopting or discarding any frame/ESSR owner. HTTP and TCP share
ordinary metadata counting: TCP reserves eight metadata-size copy allowances plus
2 MiB for bounded serializer readers/output before constructing the serializer,
in addition to its two transport chunk allowances. Serializer output is re-chunked
under the configured backing ceiling. The caller retains its original owners until
joined completion. This conservative policy is not an RSS bound.

The application flow in `tcp-conversation.ts` composes `converseCesrTcp` and
`streamCesrTcpConversation` from a borrowed `services`, `intake` and `reactor`.
The lower TCP engine in `tcp-egress.ts` knows none of those application processor
types. It lends a bounded byte source to a scoped `TcpRead` consumer. Consumer
setup precedes connection; its returned operation runs after connect, concurrently
with output. This reuses the existing pull stream, without another queue or prefetch.

The application selects `replies: { services, intake, reactor, local?, consume? }`;
default lower-level send options remain transmit-only. An explicit transport
services override must match the application receiver's services. TX credit, a
logical 2 MiB read/handle allowance and FrameIntake's RX stream/64 KiB producer/
8 MiB cursor credit precede connect. The socket source starts after connect.
These are JS/logical bounds, with native pools/kernel buffering separately qualified.
One RX parser settles frames concurrently with TX under `allowHalfOpen: true`.
Genuine RX EOF leaves TX alive. TX EOF starts one absolute drain deadline; reply
activity cannot refresh it. Failure/cancellation aborts both directions before
joining either cleanup, with credit and borrowed receiver/frame/payload owners held
through parser/source/write/socket cleanup. Callback envelopes are non-retaining
and guarded; do not reenter Reactor or implicitly drain network cues there.
The application flow's `conversationDrained` result means local transmission plus
processed RX EOF. Lower-level TCP returns only `transmitted` and counts no protocol frames.
`processedFrames` counts dispatch attempts, including refusal/escrow/ignored inputs,
not verified replies or durable remote acceptance. Inspect route decisions and
accepted state explicitly; KEL dispatch may return no decision. Earlier accepted
replies survive a later transmit failure. This maps 714's concurrent local TCP
reply parsing without copying its `sent`/`idle` acceptance ambiguity; guarded
delivery and actual caller/listener same-socket adoption remain successors.
Receipt endpoints intentionally return one finite proof: collection admits at
most 1 MiB, failed-response diagnostics at most 16 KiB, and parsing requires one
complete frame. Cancellation joins the body reader and releases its lock.
The shared HTTP response resource also owns the handoff after headers arrive;
continuous OOBI, authentication, query and mailbox workers close a finite call
scope after each response so neither bodies nor resource registrations accumulate.

## Query delivery and mailbox SSE

The query cue sink admits at most eight finite 8 MiB signed request streams.
The runtime drains those requests after its guarded cue turn, preserving a failed
request for retry. Its HTTP response stays in the delivery scope and enters the
progressive Reactor directly. Runtime closure aborts and joins the active delivery
before closing stores; a consumer never reenters its own guarded turn.

Mailbox SSE consumes one complete event at a time and awaits the consumer before
reading again. Each event admits at most 8 MiB of wire bytes and 4,096 fields; transport chunks
admit at most 1 MiB. EOF, timeout, and cancellation discard an unterminated event,
leaving its cursor available for retry. The first event may use the full poll
window; an idle poll ends after 500 ms once an event has completed. Every timeout
cancels and joins the single pending read. Long-lived mailbox workers admit and
hand off each event before requesting the next. Command-local polling uses one
absolute turn budget and resumes at the next endpoint/habitat after every attempted
poll, so an empty early long poll cannot starve a later proxy. Its resume position
retains only integer indices; discovery preserves existing borrowed habitat and
per-habitat endpoint metadata, without a new flattened peer queue. It returns
ordinary batches collected during the poll window, without record/byte quotas
or a durable consumer inbox. Continuous sinks finish before cursor advancement.
The earlier reader owner also observes late read/cancel failures after scope halt
and always attempts lock release. Only exact owned abort reasons or a failure
already propagated by this invocation are suppressed; foreign AbortErrors remain
failures. Distinct consumer/read and cleanup failures propagate together. Successful
idle/deadline expiry still ends a poll without accepting its incomplete event.

Provider SSE performs no mailbox reads without HTTP demand, releases each LMDB
iterator before suspension, and copies at most 64 KiB per transport pull from one
admitted 4 MiB stored message. A blocked consumer cannot accumulate a mailbox
replay in the platform stream queue. Provider responses reserve shared message,
chunk and bounded topic-metadata credit before acquisition, with one stream slot
across query correlation and nested output. Native row preflight checks the 4 MiB
ceiling before copying. Director/runtime close joins cancellation before stores.

OOBI CESR responses enter the progressive Reactor directly, including canonical
`application/cesr`, legacy `application/json+cesr` and `application/cesr+json`.
Independent counted events may become accepted before response EOF. One scoped
job retains the queued row through complete intake and joined cancellation;
partial failure clears its in-flight marker while retaining retry ownership and
already accepted events. Transient admission/cue saturation leaves that row for
the existing worker; size, I/O and unexpected failures propagate. No extra queue
or retry scheduler is introduced. `oobiResolved` retains retrieval-completion
semantics; it is not proof that every incoming event was independently accepted.

Oobiery borrows the Reactor's exact policy. A 1 MiB minimum byte lease precedes
fetch and bounds cooperating pending GET handles; Reactor separately reserves
its one active parser stream before body-reader acquisition. This avoids charging
the same receive lifetime twice. The job owner clears only after body/parser/fetch
cleanup joins, preventing concurrent retries. JSON/schema OOBIs keep an 8 MiB
collection ceiling and a conservative 64 MiB copy/decode allowance before reads.
These logical charges require native/metadata qualification; they are not an RSS
bound. OOBI replay serving still collects output and remains transport S2 work.

DID `keri.cesr` resolution enters Reactor progressively using the exact runtime
HTTP services/policy. A 1 MiB request allowance and parser source admission precede
fetch; body/parser cleanup joins before returning credit. Independently accepted
events remain on late failure/cancellation; no DID result or hosted JSON fetch
precedes genuine CESR EOF and escrow processing. Complete generated-versus-hosted
document comparison remains required. Hosted JSON retains an 8 MiB collection cap
and one stream/64 MiB logical copy allowance through decoding, normalization and
comparison. This is conservative allowance, not a measured native/heap bound:
accepted alias projection may grow independently of the incoming JSON cap.
Decoded/projection copy qualification remains phase 4 work. The returned document
transfers to caller ownership; resolution credit ends after joined cleanup.
Only default native fetch-header TypeError and non-ok HTTP responses may try the
existing alternate URL; injected client TypeError, body/parser/storage/admission
and cancellation failures propagate. HTTP-refusal cleanup failure prevents fallback.
The shared `streamBytes` reader joins one cancel Promise and always releases its
lock. A single failure keeps its identity; distinct read/cancel/unlock failures
propagate together as an AggregateError. Parent cancellation/error reporting
remains part of composed owner qualification. Existing
HTTP scheme fallback remains a compatibility policy, not strict TLS qualification.
Static Tufa artifacts reserve one shared stream and 1 MiB of logical handle/metadata
allowance plus two 64 KiB buffers before opening a regular file. Response demand
causes each read; no source prefetch or whole-file allocation occurs. Capture the
opened file's extent, ignore later growth, and fail on truncation; this is not a
content snapshot. Static JSON additionally checks its 8 MiB ceiling before reads.
Request abort owns acquisition only. Cancellation/host close stop new reads and
join pending filesystem work and descriptor close before returning credit.
The protocol handler and Hono app expose close; default handlers are owned while
injected handlers remain caller-owned. OS reads are joined, not forcibly interrupted;
native/filesystem residency still requires qualification. Dynamic generation/export
collects histories; its further streaming conversion is deferred.
Dynamic `did.json` uses JSON-only artifact construction with the same local-AID
validation, schema pinning and document bytes. It never opens CESR replay;
further JSON preparation and streamed CESR generation/export changes are deferred.
The Node host terminates a failing post-header body and reports its original error;
it cannot replace already transmitted 200 headers with a new status.
Finite JSON documents and receipt proofs retain whole-document semantics with
bounded admission and joined cancellation. Mailbox admin response metadata admits
1 MiB, and the raw operator SSE diagnostic report admits 16 MiB. Those finite
collectors use the same owned, cancellable byte reader.

Provider connections and per-request topics now share finite runtime admission.
Configured remote-worker counts and retained query cues still need their own
handle/metadata boundary; these leases do not bound accepted configuration/state.

Stored endpoint reply reconstruction uses configurable local defaults of 8 MiB
per message and 4096 scanned proof rows. The native reply body is preflighted
before copying; proof retention and exact counter-framed output size are checked
before growth/final serialization. These limits are not protocol invalidity or a
shared memory bound. Missing body returns empty; corruption and I/O failures
propagate. Native proof-row decoding/copy pre-admission remains phase 5.

Reconstruction follows actual 714 `Hab.loadEndRole`/`loadLocScheme` and `fetchTsgs`:
all transferable groups retain canonical prefix/SN/digest order and stored seals,
without reopening establishment bodies. Existing compact TS SN keys are padded
only for ordering/reconstruction; stable raw-key ties retain each original group
and accepted/escrow tables are not rewritten. Exactly one cigar may accompany them.
Zero/multiple cigars contribute no couple. No remaining authenticator fails rather
than emitting an unproved raw body. `messagize` accepts ordered groups under one
aggregate counter, widening v1 ordinals and preserving v2 qualified ordinals.
The caller's attachment genus floor remains explicit and the body may raise it.
Independent actual-helper observations verified 64 imported 714 modules, group
order `[0,1]`, v1 `-VBn-FAC` / v2 `-CBn-XBm` tails, one/two-cigar selection and
missing-authenticator failure. Lazy OOBI selection and finite forwarding collection
remain subsequent S2 units.

Generic WitnessReceiptor submission prefers HTTP receipt endpoints, with TCP-only
fallback through the existing same-socket conversation engine (`local=true`).
Explicit Receiptor endpoint calls retain their HTTP-only contract.
TCP EOF/local drain is insufficient: the requested witness's indexed signature
must already be verified and persisted in the event's wigs before success and
complementary fanout. Standalone Receiptor/WitnessReceiptor attempts own one scoped
runtime; callers with an active runtime supply it explicitly and retain its stores
through joined cleanup. Catchup and fanout reuse that receiver. The generic
sendWitnessMessage helper parses TCP replies only with explicit receiver context;
its context-free form remains a transmit-only primitive.

Default runtime Anchorer turns explicitly lend their existing runtime to TCP
witness publication; a standalone turn without receiver context stays transmit-only.
Witness inquiry routing prefers HTTPS/HTTP before TCP. The existing RuntimeDeliveries
query owner retains its wire, abort signal and admission through same-socket local
reply parsing and joined cleanup. Guarded query preparation opens no socket.
Retiring that owner records transport completion only; query continuations complete
from Kevery-verified accepted state, never from drain or received frame counts.

Accepted Tufa TCP sockets use one receive parser and bounded event-prefix/SAID or
query-SAID response slots. Only accepted/duplicate event decisions authorize
receipt output. Preparation owns proof and replay hydration credit under the
Reactor guard; the shared socket writer drains outside it, borrowing that
connection's stream slot. Receive EOF starts one absolute reply-drain deadline.
One unresolved logs/ksn query stays in its existing bounded response slot; another
query on that connection receives a busy refusal. Its one readiness observer can
wake output while one joined parser pull remains live, with no result queue.
The host kernel supplies runAgentRuntime's escrow driver; standalone listener
borrowers must provide that driver for idle-RX query retries. Genuine receive EOF
keeps TX available for the pending reply under the same absolute deadline.
Cancellation joins the pull and output before releasing reply or connection credit.

Signaler holds ordinary transient UI wakeups. A matching collapse key replaces
its queue position; expiry and clear remove hints. There are no queue/byte quotas,
prepared signals, JSON estimates or reservation lifetimes. Notifier writes the
signed notice first, then publishes its hint after success. A false/throwing notice
write emits no hint; a later signal failure propagates without undoing durable
state. Runtime/CLI close their created producers and leave injected signalers open.

Runtime output resources are acquired after their backing registry stores so
reverse scope teardown joins delivery cancellation and closes lazy replies before
store cleanup. The scoped default CueDeck follows backing stores and precedes
processors/output consumers, clearing queued owners after joined outputs.
Explicit-close callers first join request/runtime tasks; close keeps that ordering
and failure aggregation, and injected stores remain borrowed.
