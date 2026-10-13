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
belongs to the caller's scope. Each complete child is dispatched before the
consumer requests the next frame, including inside a counted enclosure. A later
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
emission array indefinitely. Replay byte representation is a separate phase 11
concern.

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
authorization uses the final query frame's exact signatures.

The generic HTTP route consumes its request body progressively and appends a
separately bounded CESR attachment header. Administrative requests still collect
an explicitly bounded 8 MiB value. Legacy feed/complete-record methods remain
only until the phase 12 API cut; they are not compatibility guarantees.
