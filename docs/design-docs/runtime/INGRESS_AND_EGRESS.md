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

Replay byte admission runs in `cloneEvtMsg` while evidence is read from storage,
before retaining each attachment and allocating the final event buffer. The raw
stored body must still be read as one value before its length can be checked.
Aggregate replay length is not collected or capped; ordinary single-event bytes
and concurrent HTTP replies remain independently bounded. Other finite callers
of `cloneEvtMsg` without a limit retain their existing allocation behavior.

## Witness and exchange output

Signed exchanges and generic HTTP witness delivery use the same progressive
sender as forwarding. Witness authorization is preserved across content-type
retries; caller headers cannot replace CESR framing or destination metadata.
Generic witness sends borrow explicit runtime services; runtime delegation passes
its own services through this seam. Standalone callers may use the shared default.
TCP reserves one stream, the supplied buffer's backing and one transport copy
before socket acquisition. The caller owns allocation of that input. Completion,
failure and cancellation join socket close before returning credit; kernel buffers
and native residency require separate measurement.
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
replay in the platform stream queue. Stored values are still read whole before
their individual size check.

Finite OOBI and DID verification currently admit at most 8 MiB per fetched
artifact, including their CESR replay document. Moving those complete verification
flows to streamed artifacts remains separate work. Mailbox admin response metadata
admits 1 MiB, and the raw operator SSE diagnostic report admits 16 MiB. Those
finite collectors use the same owned, cancellable byte reader.

Mailbox-provider connection count and configured endpoint/topic counts do not yet
share an aggregate runtime reservation. Their cross-source concurrency budget
belongs to the planned shared resource-policy follow-up, not these per-reader
and per-event bounds.
