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
annotation, v2 forwarding, and the four supported nested multisig routes are implemented. Other nested runtime routes,
shared runtime reservations, and final qualification remain follow-ons.

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

## ESSR verification, encryption, and durable storage

Texter boundaries are fragment boundaries, not necessarily sealed-message
boundaries. Validate the logical ESSR digest over the ordered concatenation of
decoded raw Texter bytes, matching KERIpy. Perform hashing incrementally without
joining the whole transfer; do not hash qualified text instead. `Diger` owns the
shared incremental algorithm registry, `verifyChunks()` and `verifyStream()`.
Exchange acceptance checks a string-valued `serder.a` after signature validation
and before handler acceptance/storage; `serder.seals` is array-only.

Recipient processing admits one bounded logical ciphertext message, verifies
required exchange evidence and payload integrity, authenticates/decrypts it with
the existing compatible sealed-box primitive, and writes its authenticated
plaintext to the selected sink. Limit concurrent decryptions. Oversized logical
messages produce an explicit resource-limit outcome, not different encryption
framing or unauthenticated plaintext output. Choose sinks by flow: a recipient
keeps its admitted ciphertext in bounded memory until decryption; it does not
automatically spill ciphertext to disk. Intentional evidence/relay retention is
the separate ciphertext-preserving flow described below.

KERIpy-compatible `.essrs` values remain qualified Texters where exchange
evidence, escrow, replay, or relay requires them. Do not replace those values with
proprietary file pointers or silently overwrite them with plaintext. Retain
insertion order and the table's duplicate semantics. Plaintext storage is
separate; its representation and digest are distinguished from original wire
ciphertext and its commitment.

Storage operations iterate items or bounded batches instead of `getAll()` on the
bulk path. File/DB publication must not expose a committed reference to missing
content. Stage, finalize, publish, and recover orphaned content with explicit
crash-recovery tests. Reopen, retry, forwarding, and serialization consume the
same references incrementally.

## Exchange proof ownership

Sender source seals authenticate the EXN only when an accepted key event at the
claimed historical coordinates contains its SAID. The anchor may be an
interaction event; transferable signature groups instead require establishment
keys. Supplemental route evidence authenticates this same body independently;
it cannot authenticate a nested child. Routes explicitly select verified
supplemental factors and may return an escrow decision for unavailable
credential/KEL/TEL dependencies. Invalidity and missing evidence stay distinct.

Resolve known last-establishment references before sender escrow so later key
rotation cannot reinterpret saved signatures. Retain source triples in `ests.`
and approved foreign endorsers in `eidx.`; restore stored cigar verifier context
for retry and recheck all stored proof factors before replay. Group leader
selection considers the group's own signatures only. Legacy v1 parser intake
still requires signatures; source-only intake is a v2 behavior. These proof
facilities do not enable guarded nested IPEX routes or complete v2 processMsg
sender/KRAM admission policy.

## Serialization and HTTP egress

`framePayload()` and `attachmentPayload()` return non-owning reopenable views of
one admitted frame. Ordinary metadata stays within the parser's frame budget;
ESSR wire is consumed incrementally through `essrChunks()`. The caller retains
every descendant `EssrPayload` owner until all output readers finish. Each child
is emitted as a `BodyWithAttachmentGroup`; non-native child bodies are qualified
Texters inside `NonNativeBodyGroup`. The child wrapper uses its parent's genus,
with any child genus selector scoped inside it. The body enclosure already
supplies the child boundary; another attachment wrapper would double its depth. Default output preserves each
node's resolved genus; an explicit `gvrsn` overrides every compatible node.
Native bodies still reject genus changes that require rebuilding their Serder.
The serializer preserves parent/child ownership, group order, child order, and
ESSR item order. It normalizes the attachment categories to ordinary leaves,
children, then ESSR; the parsed model does not retain original cross-category
interleaving. One payload view per admitted node and finite body/group metadata
remain under existing tree admission limits. No descendant ESSR is collected.
Cancellation closes active readers without disposing the caller's tree owners.
Finite annotation preserves the original tree wire. KERI normalization admits
v2 `/fwd` trees with route-specific child commitments and durable evidence.
Other nested routes and HTTP inspection retain their consumer guards. Output chunks are owned
copies of at most 64 KiB; custom ESSR wire readers retain the existing 1 MiB
maximum backing-allocation contract.

Each message's ordinary attachment leaves use one selected genus; enclosed
children may select their own genus inside their own boundary. The entire output
tree uses one attachment wire domain.
KERIpy `main` at `927c0cb8794d7c84fc17143c67df64aab9deda6c` permits a GVC only
at its beginning and rejects nested attachment enclosures or mixed domains.
Progressive parsing can accept broader scoped input, but forwarding normalizes
known leaf tuples rather than reproducing interior selectors. Transferable
signature tuples retain their required small controller counter. A genus
conversion that would need a big inner counter, or would reinterpret opaque
content, fails explicitly; same-genus opaque wire remains byte-preserving.

KERI's `requestFrame()` is an Effection resource. Header mode admits at most
64 KiB of text-qualified attachments by default; it uses the body's inferred
genus for the outer header and one initial selector when needed. Body mode
streams the complete admitted frame. A response remains readable inside its
resource scope; exit aborts and joins request preparation, fetch, upload, and
response cleanup. Failed-response diagnostics retain at most 16 KiB by default.
`postCesr()` awaits one frame's delivery and disposal before asking the parser
for its next output. These policies do not yet migrate replay cues, CLI
annotation, or retained mailbox queues; those remain later phase-11 slices.

### Proposal construction boundary

Multisig v2 body construction is synchronous: `multisigExnBody()` receives the
parsed child's `SerderKERI`, checks the supported route/child ilk, and commits its
SAID. It performs no byte parsing, payload I/O, storage access, or disposal, and
cannot authenticate child signatures. Already-parsed callers retain their
`CesrFrame` and use `nestedPayload()` plus the existing serializer; these views
borrow every owner until consumption completes.

Byte callers use `prepareMultisigEventExn()` through the route convenience
operations. It owns `parseBytes()` results, delegates body construction, collects
nested wire under the existing 8 MiB ceiling, and joins all frame disposal in
`finally`. Cancellation aborts underlying reads and joins their cleanup before
returning. Its result is finite bytes, with no lazy owner escaping. V1 callers
retain established pathed encoding. Parent signatures and nested evidence must
remain within one parent attachment enclosure. Apply the same split to IPEX
construction as its route processing is implemented.

## Cancellation and resource policy

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

## Required regression evidence

These are acceptance obligations; their tests land with the corresponding phase.

| Behavior             | Required proof                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Early child delivery | Hold the source before sibling B; receive wrapped child A first, including nested GenericGroups, both domains and genera |
| Frame boundaries     | Unwrapped attachments wait for lookahead/EOF; single-frame wrappers reject extra children before yielding                |
| Partial failure      | Valid A survives malformed/truncated B without duplication or deletion of A's payload                                    |
| Enclosure isolation  | Impossible child extent fails while input is blocked; queued sibling bytes cannot complete it                            |
| Versions/counts      | Preserve scoped selectors, legacy inference, both count models, big counters, and every-byte split regressions           |
| Backpressure         | Paused consumer/throttled sink bounds producer reads and pending work                                                    |
| Cancellation         | Interrupt blocked input and sink writes; close once and remove only unfinished stages                                    |
| Payload integrity    | Fragmented digest equals KERIpy concatenation; wrong digest or failed decryption publishes no accepted plaintext         |
| Durable behavior     | Reopen/retry/replay, original `.essrs` interoperability, crash recovery, and orphan cleanup                              |
| Memory               | Fixed item size with rising aggregate size keeps queues and retained metadata within declared budgets                    |

Reference pins for tables, CLI interoperability, and source comparisons remain
explicit and independent. This migration does not silently upgrade generated
codices to a newer KERIpy revision.

## Framework boundary

The CESR root exposes async iterables and AbortSignal without importing Effection.
The supported optional `cesr-ts/effection` entrypoint exports FrameChannel and
toEffectionFrames. Its single-subscription Effection Stream supplies pull
backpressure and owns source cancellation and joined cleanup. KERI and Tufa use
Operation scopes around parsing, dispatch, and transport lifetimes; merely
awaiting a Promise with `call` does not cancel the underlying I/O.
