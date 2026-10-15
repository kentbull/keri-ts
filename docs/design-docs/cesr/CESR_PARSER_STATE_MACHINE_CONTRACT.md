# CESR Parser State Machine Contract

This describes the transitional lifecycle of `parser/progressive.ts` and its finite
`parser/complete.ts` collector. The [progressive contract](CESR_PROGRESSIVE_PARSER_CONTRACT.md)
describes payload ownership and codec correctness. Parser accounting and the
former atomic engine are removed. [ADR-0012](../../adr/adr-0012-progressive-nested-parser.md)
now requires a buffered finite decoder, replacing progressive traversal and parser
staging. The behavior below is not a preservation requirement for that migration.

## Lifecycle and ownership

`parse(source, options)` is an async generator over an async byte source. Each
pull requests one complete frame. Generator locals retain nested progress;
a segmented cursor owns input, declared enclosure ends, and cancellation.

| Boundary                              | Required behavior                                                                |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| Partial producer read or empty chunk  | Suspend; retain the open frame and exact nested position.                        |
| Following body                        | Complete the preceding open attachment set with bounded lookahead.               |
| Complete attachment enclosure         | Complete its frame; reject attachments outside that enclosure.                   |
| GenericGroup child                    | Yield a complete child before requesting remaining siblings.                     |
| BodyWithAttachmentGroup               | Require one complete parent tree and exact enclosure exhaustion before yielding. |
| Source EOF                            | Complete an open frame only when no partial attachment remains.                  |
| Malformed input or terminal shortage  | Throw once and finish; retain delivery of earlier complete frames.               |
| Cancellation or early iterator return | Join input cleanup and discard all undelivered payload stages.                   |

Source exhaustion supplies EOF; there are no feed, flush, reset, or framed-mode
APIs. A new source invocation starts with fresh genus selection. Transport chunk
boundaries and annotation separators never delimit messages. A partial token
inside a fully received declared enclosure is a `GroupSizeError`, not a shortage
that later transport bytes could repair.

`parseBytes` collects complete input and transfers all returned frames together.
Failure disposes every collected payload; successful callers own delivered ESSR
payloads and use `discardFrame` after consumption. Descendants remain borrowed
from their root. No byte/node/depth/item quota or hidden frame-credit registry
controls parsing or disposal.

Bodies hydrate through Serder. Attachment wrappers flatten into ordered semantic
leaves; enclosed messages remain separate `nests` records with their own evidence.
A parent yields only after every descendant finishes and its wrapper exhausts.
Failure or cancellation aborts every unfinished stage and disposes every finished
undelivered owner. Earlier independent delivered siblings survive. ESSR streams
through awaited writes; declared token counts, lengths and qualification padding
remain exact framing requirements. Source/sink failures retain their identity.
Parsing never authorizes or verifies a KERI event.

One input owner shares consumed-work counters across every child cursor. It
yields a host turn after 64 KiB consumed or 4,096 source-pull/consume operations;
empty producer chunks count as work. A single operation may
cross the byte quantum. This fixed local scheduling policy changes no wire
boundary and does not reject input. Cancellation wakes and clears the owner's single
checkpoint timer, preserving the original failure and joined source cleanup.

## Genus and protocol versions

Stream genus selects counter and attachment decoding independently of body
protocol metadata. `parseBody` validates body metadata; progressive traversal
owns stream and enclosure context.

- Null selection permits legacy frame-start inference, including implicit v1.
- An explicit genus selector persists across chunks and following v1 bodies.
- Inner selectors apply to subsequent siblings in their enclosure only.
- Body protocol major cannot exceed stream genus major; declared body genus
  must be supported and cannot exceed the selected major or minor.
- Attachment handlers use the selected genus once. Unknown codes, malformed
  primitives, and wrapper tails never trigger cross-major retry.
- Selected counter probes never infer a different major. Both minor sextets in
  a genus selector are validated through the supported registries.

| Counter family                                | v1 count                  | v2 count                                |
| --------------------------------------------- | ------------------------- | --------------------------------------- |
| Signature, receipt, replay, and seal groups   | Items                     | Payload quadlets/triplets               |
| Nested transferable/last-establishment groups | Items at each level       | Payload quadlets/triplets at each level |
| Wrappers and enclosures                       | Payload quadlets/triplets | Payload quadlets/triplets               |
| Genus selector                                | Version value             | Version value                           |

Payload counts exclude their own counter header. A complete bounded payload
must be consumed exactly. Protocol v1/v2 support remains; old keri-ts API
compatibility is not a protocol requirement.

## Contract-to-test mapping

Paths below are relative to `packages/cesr/test/unit/parser`.

- **Early children, nested suspension, partial failure, cancellation:** `progressive.test.ts`,
  `cursor.test.ts`.
- **Bytewise partitions, empty reads, open attachment sets, closed boundaries:**
  `chunk-completion.test.ts`, `count-units.test.ts`.
- **EOF emission and terminal rejection:** `eof.test.ts`, `complete.test.ts`.
- **Genus selection, scope restoration, implicit v1:** `genus-context.test.ts`,
  `version-context.test.ts`, `wrapper-version.test.ts`, `implicit-v1.test.ts`.
- **Mixed domains and enclosure order:** `mixed-stream.test.ts`, `generic-group.test.ts`,
  `enclosure-parity.test.ts`.
- **Native/opaque hydration and malformed input:** `external-fixtures.test.ts`,
  `enclosure-errors.test.ts`, `frames.test.ts`.
- **Independent KERIpy facts:** `external-corpus.test.ts`, `attachment-parity.test.ts`.
- **Payload bounds, sink backpressure, and ownership:** `essr.test.ts`, `effection-frames.test.ts`.

KERI source and complete-record dispatch are covered by
`packages/keri/test/unit/app/reactor.test.ts`. Contract changes require matching
source, semantic regressions, and reference-version evidence.

## Nested message evidence

`test/unit/parser/nests.test.ts` compares signed Python `927c0cb8` trees in txt/qb2,
protocol v1/v2 and JSON/CBOR/MGPK/native forms. It covers child-local genus selectors,
v1 nesting, every-byte splits, malformed later children, closure boundaries,
cancellation during reads and finish, collection failure, and
repeated recursive disposal. Runtime boundary coverage is in
`packages/keri/test/unit/app/nested-frame-boundary.test.ts`.
`test/unit/parser/serialize-nests.test.ts` covers structure-preserving payload
views in both domains/genera, scoped children, independent signatures, repeated
ESSR reopening and cancellation. `packages/cesr/scripts/qualify-nested-serialization.ts` feeds
actual output to frozen Python, verifies imported source bytes, signature
ownership, full consumption, and Python subtree reserialization.
`test/unit/annotate-nests.test.ts` checks exact frozen Python wire round-trips,
scoped genera, root/child presentation, exactly-once traversal, and recursive
ESSR transfer/cleanup on success, failure, and cancellation. Nested runtime
forwarding preserves evidence through exchange escrow, storage, reopen, and
replay; `packages/keri/test/unit/app/exchanging-nests.test.ts` covers those
route and ownership decisions. Nested multisig uses the same durable ownership and requires route-specific
commitments and local approval before child verification/replay.
`packages/keri/test/unit/app/grouping-nests.test.ts` covers actual two-participant
approval ordering, child proofs, dependencies, reopen/retry, rollback and cancellation.
It also checks the pure proposal-body boundary, direct parsed-frame wire preparation,
and byte convenience ownership: cancellation must abort reads and join disposal
before returning. Constructing a parent never authenticates its child.
Nested IPEX offer/grant evidence is covered by
`packages/keri/test/unit/app/ipex-v2.test.ts`; conversation and issuer proof rules
live in the [IPEX contract](../exchange/IPEX.md). Unfinished routes and HTTP inspection remain guarded. A frozen 40-node fixture verifies serialization preserves nested
enclosure structure without a depth policy.
