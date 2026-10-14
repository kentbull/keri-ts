# Progressive runtime ingress

`Reactor.process(source, options)` is an Effection operation. The source factory
receives the operation's abort signal and supplies bounded, independently owned
chunks. `chunkBytes`, `streamBytes`, and `fileBytes` adapt a finite value, Fetch
body, or Deno file. A file source can be consumed directly:

```ts
yield * reactor.process((signal) => fileBytes(path, { signal }));
```

`Reactor.frames` exposes the optional CESR Effection channel when an edge needs
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

HTTP query replies carry the requesting query SAID. A bounded request reservation
captures matching replies before background consumption. Duplicate requests
share the same readonly replay reference. Reservations are released on response,
failure, and cancellation. Only a query at the end of the request controls the
HTTP response. Earlier queries retain ordinary reply delivery; their reserved
reply moves to guarded delivery before the reservation is released. Mailbox
authorization uses the final query frame's exact signatures and dispatch decision.
A current sender refusal prevents opening a response even when an earlier matching
query cue exists. See [v2 message admission](../exchange/MESSAGE_ADMISSION.md).

The generic HTTP route consumes its request body progressively and appends a
separately bounded CESR attachment header. Administrative requests still collect
an explicitly bounded 8 MiB value. `Reactor.processBytes` supplies a finite value to the same progressive source
path; it owns parsing and dispatch through an Effection operation. No shared
feed buffer or separate synchronous parser remains.

## Socket-to-application boundary (implementation pending)

The required transport path is a bounded abortable source, one progressive parser
per connection/request, complete frames, guarded verification/storage, and owned
delivery outside the guard. HTTP body intake already uses this parser path; TCP
currently collects until connection completion. Existing cue consumers can still
await network I/O under the guard. The [transport plan][transport-plan] owns closure;
these requirements do not describe completed TCP support.

`socketBytes` is the shared KERI runtime TCP source prerequisite; listener/parser
integration remains pending. It acquires exclusive binary readable-mode ownership
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

## Messenger responsibilities

Incremental source/sink I/O is the default for CESR network traffic across KERI
and Tufa. Callers share the runtime's exact services/resource policy, preserve
borrowed owners and propagate cancellation through joined cleanup. GET retrieval,
SSE and non-CESR documents preserve their framing; they reuse ownership facilities
rather than being wrapped in a CESR POST. A finite collector needs a semantic
reason and enforced admission/cap, not merely a legacy byte-input API.
The [stack adoption inventory][transport-plan] marks remaining callers explicitly.

Two engines own transport work: CESR HTTP request/response scopes and an owned
TCP connection with directional I/O. Small Effection operations/resources expose
finite-message and source inputs. This mapping defines responsibilities; the TCP
finite/source writers exist; complete caller integration remains planned in S1–9.

| KERIpy responsibility | TypeScript entry / shared engine                    |
| --------------------- | --------------------------------------------------- |
| HTTPMessenger         | `requestFrame`; finite bytes via `postCesr`         |
| HTTPStreamMessenger   | `postCesr` source and scoped response consumer      |
| TCPMessenger          | `sendCesrTcp`; parsed-frame adapter remains planned |
| TCPStreamMessenger    | `streamCesrTcp` abortable source on the same engine |

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

The HTTP engine owns upload, fetch and response cleanup; its scoped consumer
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
The extraction itself adds no queue or shared allocation guarantee.

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
when that replay is consumed.

`ReplyStreams` owns up to eight live HTTP replies by default. Each pull copies at
most 64 KiB from one event; transport cancellation or runtime closure releases
the iterator and event. The response lifetime is independent of ingress: Deno's
legacy request signal aborts when its handler returns. No background task or
whole-replay array is needed for these synchronous database readers.

`QueryCoordinator` caps pending requests and continuations separately. A request
retains its queue credit until delivery succeeds; failure leaves it available
for retry. Concurrent drains cannot send the same head, and newly appended work
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
bounded handoff adoption. Tufa TCP listener supervision and socket-to-application
wiring remain S6 work; this source API alone does not enable that route.

## Witness and exchange output

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
Parsed-frame pre-serializer admission and explicit concurrent reply parsing remain
successors; no parsed input is serialized and reparsed by these operations.
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
hand off each event before requesting the next. Command-local polling retains
only a finite batch (256 records / 16 MiB by default), with a 4 MiB per-record
limit; the durable inbox retains its independent capacity and explicit disposition.

Provider SSE performs no mailbox reads without HTTP demand, releases each LMDB
iterator before suspension, and copies at most 64 KiB per transport pull from one
admitted 4 MiB stored message. A blocked consumer cannot accumulate a mailbox
replay in the platform stream queue. Provider responses reserve shared message,
chunk and bounded topic-metadata credit before acquisition, with one stream slot
across query correlation and nested output. Native row preflight checks the 4 MiB
ceiling before copying. Director/runtime close joins cancellation before stores.

Finite OOBI and DID verification currently admit at most 8 MiB per fetched
artifact, including their CESR replay document. Moving those complete verification
flows to streamed CESR artifacts is required by transport S2 before release.
DID resolution remains complete-evidence verification, even when intake streams.
OOBI/DID replay serving and witness GET query output still collect histories;
these are open adoption gaps. Finite JSON documents and receipt proofs retain
whole-document semantics with bounded admission and joined cancellation.
Mailbox admin response metadata admits 1 MiB, and the raw operator SSE diagnostic report admits 16 MiB. Those
finite collectors use the same owned, cancellable byte reader.

Provider connections and per-request topics now share finite runtime admission.
Configured remote-worker counts and retained query cues still need their own
handle/metadata boundary; these leases do not bound accepted configuration/state.
