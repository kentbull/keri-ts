# Progressive CESR Parser Contract

## Status and scope

**Partially implemented; runtime and payload migration remains in progress.**
[ADR-0012](../../adr/adr-0012-progressive-nested-parser.md) authorizes the migration.
`parser/progressive.ts` now provides `parse(source, options)` and the async frame
adapters use it. Nested GenericGroups delegate through `yield*` and deliver
complete children before their enclosing payload finishes. The
[current synchronous contract](CESR_PARSER_STATE_MACHINE_CONTRACT.md) still
applies to callers of the temporary `CesrParser`/`parseBytes` path.

The parser materializes bodies and ordinary attachment leaves through the existing
Serder and selected-version handlers. `maxFrameBytes` defaults to 8 MiB and bounds
that resident metadata; `maxAttachmentGroups` separately caps retained ordinary
leaf objects at 4,096, including empty groups. Structural attachment wrappers flatten to ordered semantic
leaves; their raw payloads are not retained. Cursor budgets separately bound
producer backing buffers, queued input, and nesting.

ESSR Texters stream into an awaited sink, with separate `maxEssrBytes` (8 MiB
concatenated decoded bytes) and `maxEssrItems` (16,384) defaults per frame. Both
limits are finite even for filesystem sinks. The default is a bounded memory sink;
`payloadSink(maxWireBytes, signal)` selects another owner. No transfer-sized or
per-item manifest array is retained. Final storage and runtime backpressure
migration remains pending; parser tests alone do not establish its memory bound.

`parser-progressive.test.ts` proves early delivery, exact single-frame wrappers,
every-byte partitions in both genera/domains, version scope restoration, partial
failure, cancellation, and frame admission. `parser-essr.test.ts` adds payload
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
or separate reset/flush lifecycle in the target API.

- Yield complete `CesrFrame` values in wire order.
- Await downstream payload writes before reading more input unless an explicitly
  bounded queue provides credit.
- On malformed input, fail once and terminate. Earlier yielded frames remain
  delivered; an unfinished frame is never yielded as complete.
- A new record or stream gets a new parser invocation and fresh genus selection.
- Finite collection helpers are explicit materialization operations with stated
  limits. They are not the large-transfer API.

Synchronous primitive readers remain useful for admitted complete tokens. Old
keri-ts aliases and compatibility-only tests are removed during migration; KERI,
CESR, and ACDC wire/version compatibility is retained.

## Frame completion and progressive enclosure reads

Only `GenericGroup` and its big form currently describe progressive sequences of
frames. Enter their declared bounds and parse available children immediately;
do not wait for the entire payload or accumulate all siblings.

A frame still completes only at a following body boundary, the end of an
explicit frame/attachment enclosure, or genuine source EOF. Chunk exhaustion,
empty chunks, and annotation separators never close an attachment set. An
unwrapped frame may require a bounded lookahead into the next body's header.

`BodyWithAttachmentGroup` contains exactly one frame. Verify that single frame
and exact wrapper exhaustion before yielding it. Do not emit its first child
and only later discover an illegal second child. Attachment groups, native body
groups, opaque groups, and ESSR fragments are not independent child frames.

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
Shared bounded collection can support finite consumers. No implicit
`.raw` getter may materialize an external payload.

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
aborts those resources. At yield, completed payload ownership passes to the
consumer. Internal recursive yields do not transfer ownership: single-frame
wrappers hold their candidate stages until exact validation. A later sibling error or generator close must not delete earlier
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

## Cancellation and resource policy

Generator `.return()` alone cannot interrupt an in-flight awaited source
`.next()`. Owned HTTP/file adapters, cursor reads, and sinks must honor a shared
abort signal. Cancellation interrupts pending I/O, then `finally` closes the
source once and aborts unfinished stages. KERI/Tufa Effection scopes own the same
cancellation; an async iterable must not escape its runtime lifetime. A supplied
generic async source must cooperate with cancellation to stop its own I/O; the
parser cannot force an arbitrary pending promise to settle. Parser cancellation
must not wait indefinitely for an uncooperative iterator to close.

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

CESR exposes async iterables and AbortSignal without importing Effection. KERI
and Tufa use Operation scopes to own parsing, dispatch, and transport lifetimes.
Their bridges must abort pending input and join cleanup before their scope exits;
merely awaiting a Promise with `call` does not cancel the underlying I/O.
