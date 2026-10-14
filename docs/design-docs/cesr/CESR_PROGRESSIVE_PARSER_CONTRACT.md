# Progressive CESR Parser Contract

## Status and scope

**One progressive engine is implemented; final runtime qualification remains pending.**
[ADR-0012](../../adr/adr-0012-progressive-nested-parser.md) authorizes this architecture.
`parser/progressive.ts` provides `parse(source, options)`; `parser/complete.ts`
provides async `parseBytes(bytes, options)` with an explicit finite input budget.
Nested GenericGroups delegate through `yield*` and deliver complete children
before their enclosing payload finishes. There is no synchronous stream engine.
The [state-machine contract](CESR_PARSER_STATE_MACHINE_CONTRACT.md) maps the
implemented lifecycle to tests. Parent-owned trees, serialization, and finite
annotation, v2 forwarding, and route-specific consumers are implemented. Consumer support is tracked in the
[roadmap](../../plans/PARITY_ROADMAP.md); shared runtime reservations and final
qualification remain incomplete.

The parser materializes bodies and ordinary attachment leaves through the existing
Serder and selected-version handlers. `maxFrameBytes` defaults to 8 MiB and bounds
that resident metadata across each pending parent tree; `maxAttachmentGroups` separately caps retained ordinary
leaf groups at 4,096 per tree, including empty groups. Structural attachment
wrappers flatten to ordered semantic leaves; nested messages retain their own evidence; their raw payloads are not retained. Cursor budgets separately bound
producer backing buffers, queued input, and nesting.

ESSR Texters stream into an awaited sink, with separate `maxEssrBytes` (8 MiB
concatenated decoded bytes) and `maxEssrItems` (16,384) defaults per owned tree. `maxTreeNodes` defaults to 256 including the root;
the shared cursor retains its `maxDepth` default of 64. Both
limits are finite even for filesystem sinks. The default is a bounded memory sink;
`payloadSink(maxWireBytes, signal)` selects another owner. No transfer-sized or
per-item manifest array is retained. Durable storage references and runtime source/output ownership preserve this
representation. Parser tests alone do not establish an end-to-end memory bound.

`test/unit/parser/progressive.test.ts` proves early delivery, exact single-frame wrappers,
every-byte partitions in both genera/domains, version scope restoration, partial
failure, cancellation, and frame admission. `test/unit/parser/essr.test.ts` adds payload
padding/extent validation, separate budgets, backpressure, and stage cleanup.
Final runtime and benchmark qualification remain pending.

The target is retained memory bounded by the active logical message and explicit
queue/resource budgets, independent of aggregate transfer size. This covers
input, parsing, ESSR processing, storage, and consumption. A benchmark of the
parser alone does not prove the complete path.

## Pull-based lifecycle

The canonical stream operation is an async generator over an async byte source,
with nested generators delegated through `yield*`. Each requested result grants
one frame of output credit. Source exhaustion supplies the record/stream end.
There is no permanent push-parser compatibility wrapper, `framed` cadence flag,
or separate reset/flush lifecycle.

- Yield complete `CesrFrame` values in wire order.
- Await downstream payload writes before reading more input unless an explicitly
  bounded queue provides credit.
- On malformed input, fail once and terminate. Earlier yielded frames remain
  delivered; an unfinished frame is never yielded as complete.
- A new record or stream gets a new parser invocation and fresh genus selection.
- Finite collection helpers are explicit materialization operations with stated
  limits. They are not the large-transfer API.

Synchronous primitive readers remain useful for admitted complete tokens. Old
keri-ts aliases and compatibility-only tests are removed; KERI,
CESR, and ACDC wire/version compatibility is retained.

## Frame completion and progressive enclosure reads

Only `GenericGroup` and its big form currently describe progressive sequences of
frames. Enter their declared bounds and parse available children immediately;
do not wait for the entire payload or accumulate all siblings.

A frame still completes only at a following body boundary, the end of an
explicit frame/attachment enclosure, or genuine source EOF. Chunk exhaustion,
empty chunks, and annotation separators never close an attachment set. An
unwrapped frame may require a bounded lookahead into the next body's header.

`BodyWithAttachmentGroup` contains exactly one parent message and its enclosed
attachment region. There, native/non-native body groups or body-with-attachment
groups introduce owned children, matching frozen KERIpy `927c0cb8` extraction.
A child's own enclosure controls its descendants; a following body outside an
attachment enclosure remains an independent message. GenericGroups inside an
attachment region, multiple wrapper-only messages without a parent body, and
extra evidence after a closed attachment enclosure are rejected.

`CesrFrame.nests` holds the plain child records in wire order. Each record retains
its own body, ordinary signatures/attachments, resolved `gvrsn`, and optional ESSR.
The body's genus metadata remains independent. The parser always supplies the
resolved frame genus; manually constructed serializer inputs may omit it.
No child is publicly yielded separately from its parent. Parse the complete owned
tree and check exact wrapper exhaustion before delivering the parent. The same source
can still yield earlier independent GenericGroup siblings before this tree completes.

Parsing and authorization remain separate. A `GenericGroup` is structural
framing; no new ancestor authorization mechanism is invented for it. Content
whose validity depends on evidence inside its own unfinished message remains
unaccepted until that message and its evidence are complete.

## Bounds and version scopes

One segmented queue owns absolute consumption and the source iterator. Bounded
views share that position with immutable end offsets; generators use them
lexically, never concurrently. Parent bounds are checked before entering a
child. Length arithmetic must remain safe and depth is checked before descent.

| Condition                                                             | Required outcome                                 |
| --------------------------------------------------------------------- | ------------------------------------------------ |
| More bytes are needed and the requested extent fits the current bound | Await input without reparsing completed items    |
| A header declares an extent beyond the enclosing end                  | `GroupSizeError` before another source pull      |
| An exact enclosure end leaves a primitive, tuple, or frame unfinished | `GroupSizeError`; outside bytes cannot repair it |
| Source EOF precedes a still-valid declared extent                     | Terminal `ShortageError`                         |
| Root EOF follows an otherwise complete open frame                     | Complete that frame                              |
| Root EOF interrupts an attachment                                     | Fail without yielding its pending frame          |

Read token headers in bounded stages, derive the exact length, then hydrate once.
Do not peek a maximum header length when a shorter valid header may end the
scope. Release consumed segments promptly. Long-lived views must not retain a
large backing allocation accidentally.

Preserve the existing genus contract: `pvrsn` is message protocol metadata;
explicit genus selection controls counters and attachments. Nested selectors
apply only to subsequent siblings in that scope. Unselected top-level legacy
inference remains available, without locking the next frame to that genus.
Selected/enclosed parsing never retries an error under another major version.

V1 item counts and v2 payload quadlet/triplet counts remain separate loops.
Sized v1 wrappers also count payload units. Genus selectors carry a version,
not a payload size. All bounded groups must exhaust their declared extent.

## Payload interfaces and ownership

CESR core depends on the small read-only contract `Payload { size, open() }`,
`OwnedPayload` with `discard()`, and `PayloadSink { write(), finish(), abort() }`. `open()` returns a fresh async byte
iterator and accepts an optional abort signal; `write()` provides backpressure;
`finish()` returns the reopenable owner; borrowed wire/raw views remain read-only. Sinks capture their operation signal.
Aborting a sink after successful finish must not delete the returned payload.
Finite annotation uses the progressive engine through an internal complete-input
collector, with an 8 MiB default input limit. Failed collection releases every
undelivered payload, even when another cleanup fails. `annotate()` releases its
temporary tree owners; `annotateFrames()` transfers them to the caller for
recursive `discardFrame` cleanup. Each `AnnotatedFrame` represents one root
with its descendants rendered inside that root's lines. GenericGroup siblings
retain independent entries and one-based root ordinals. Ownership-scoped traversal
consumes every hydrated node exactly once while preserving original wrapper
headers, indentation, scoped genus selectors, signatures, and ESSR wire order.
Deannotation restores the original qualified text, including for qb2 inputs. Validation
consumes file/stdin chunks progressively and discards each delivered payload.
Convenience benchmarks retain a finite corpus, defaulting to 64 MiB, and reject
malformed runs instead of reporting successful throughput. No implicit `.raw`
getter may materialize an external payload.

Runtime implementations own filesystem paths, staged storage, promotion, and
cleanup. A parsed large attachment must not also retain a full `CounterGroup.raw`
copy or an unbounded array of items/references. Use sequential payload storage
without an in-memory fragment manifest. `CesrFrame.essr` stores one canonical
counterless qb64 Texter sequence in `wire`, its ordered item count, resolved frame
`gvrsn`, and a non-owning `raw` view that incrementally decodes that wire. The
canonical sequence retains item codes and boundaries, but not incoming enclosing
counters or text/binary presentation. Replay chooses counters for its requested
genus/domain. `discard()` releases the sole wire owner and invalidates both views.
`essrPayload()` reconstructs these views from an owned stored wire payload.
The decoded view admits `wire.open()` backing buffers up to 1 MiB; custom sinks
must meet this reader chunk contract just as the built-in 64 KiB memory/file
readers do. A small view over a larger allocation is rejected rather than
silently pinning that allocation.

The parser owns unfinished frame resources. On parse failure or cancellation it
aborts those resources. At yield, completed payload ownership for the entire tree passes to the
consumer. `discardFrame(frame)` claims every descendant owner before awaiting
cleanup, so overlapping or repeated consumer cleanup releases each owner once.
It attempts all owners even when one discard fails. Internal recursive yields do not transfer ownership: parent message
wrappers hold all descendant stages until exact validation and finalization. A later sibling error or generator close must not delete earlier
yielded payloads. Consumers discard rejected/unclaimed owners and promote
accepted content only after required verification.

## Cancellation and resource policy

Hosts may opt into `classifyWireErrors` to receive `WireParseError` for intrinsic
progressive wire decoding failures, with the original parser failure as its cause.
Default error classes stay unchanged. Invocation-local provenance preserves errors
thrown by supplied sources, sink factories/writes and shared admission. Payload
finish/metadata, cancellation, source/sink/owner cleanup and consumer work remain
outside this classification. Cleanup failure still propagates its aggregate;
hosts must not classify an arbitrary `ParserError` as peer misconduct.

Generator `.return()` alone cannot interrupt an in-flight awaited source
`.next()`. Owned HTTP/file adapters, cursor reads, and sinks must honor a shared
abort signal. Cancellation interrupts pending I/O, then `finally` closes the
source once and aborts unfinished stages. KERI/Tufa Effection scopes own the same
cancellation; an async iterable must not escape its runtime lifetime. A supplied
generic async source must cooperate with cancellation to stop its own I/O; the
parser cannot force an arbitrary pending promise to settle. Parser cancellation
must not wait indefinitely for an uncooperative iterator to close.

Tree admission charges each retained body and ordinary group once, before
hydration; enclosing counters do not double-charge descendant wire. Descendants
share ordinary bytes, leaves, nodes, decoded ESSR bytes, and Texter counts. ESSR
credit is reserved from the header before payload writes. Each independent stream
or GenericGroup message starts fresh tree credit.

Resource budgets cover producer chunk size/read-ahead, admitted body/token and
logical ciphertext sizes, ordinary attachment metadata, nesting depth, concurrent
work, and open resources. These are explicit deployment policy, not narrower
claims about valid CESR encodings. A producer yielding one enormous buffer can
already exceed the budget; slicing it into views does not remove its allocation.

## Framework boundary

The CESR root exposes async iterables and AbortSignal without importing Effection.
The supported optional `cesr-ts/effection` entrypoint exports FrameChannel and
toEffectionFrames. Its single-subscription Effection Stream supplies pull
backpressure and owns source cancellation and joined cleanup. KERI and Tufa use
Operation scopes around parsing, dispatch, and transport lifetimes; merely
awaiting a Promise with `call` does not cancel the underlying I/O.

## Related ownership contracts

- [Serialization](SERIALIZATION.md) borrows complete frame trees.
- [ESSR recipient](../essr/RECIPIENT.md) owns authenticated plaintext.
- [Exchange proofs](../exchange/EXCHANGE_PROOFS.md) never authenticate child proofs implicitly.
- [Payload storage](../db/PAYLOAD_STORAGE.md) owns durable publication and recovery.
- [Runtime ingress/egress](../runtime/INGRESS_AND_EGRESS.md) owns processing and transport scopes.
- [Parser plan](../../plans/cesr/CESR_PROGRESSIVE_PARSER_PLAN.md) owns remaining parser-specific gates.
