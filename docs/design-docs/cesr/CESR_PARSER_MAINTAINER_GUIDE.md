# CESR Parser Maintainer Guide

The parser has three owners: stream state, frame boundaries, and attachment
contents. The [state-machine contract](CESR_PARSER_STATE_MACHINE_CONTRACT.md)
defines the temporary synchronous completion and version rules. The async
`parse(source, options)` entrypoint and frame adapters now use the
[progressive contract](CESR_PROGRESSIVE_PARSER_CONTRACT.md); payload and runtime
migration remain in progress. This guide maps both paths to their owners.

## Read the code in this order

| Module                                    | Responsibility                                                                                                                               |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/cesr/src/parser/progressive.ts` | Async generators own scoped genus and frame progress; `yield*` emits GenericGroup children early.                                            |
| `packages/cesr/src/parser/cursor.ts`      | Segmented input, exact bounded reads, cancellation, and resource limits.                                                                     |
| `packages/cesr/src/parser/stream.ts`      | `CesrParser` owns bytes, offset, selected genus, pending frame, and queued siblings. `feed`, `flush`, and `reset` are the lifecycle.         |
| `packages/cesr/src/parser/frames.ts`      | `parseFrameStart` reads a body or enclosure. Bounded children are parsed atomically by ordinary functions.                                   |
| `packages/cesr/src/parser/attachments.ts` | `parseAttachments` walks a frame's attachment set; `parseAttachmentGroup` selects a direct v1/v2 handler and hydrates known primitive roles. |
| `packages/cesr/src/parser/common.ts`      | Shared frame-family names, default genus, and selector code.                                                                                 |
| `packages/cesr/src/core/domain.ts`        | `CesrDomain` width helpers: `tokenSize`, `unitBytes`, and domain narrowing.                                                                  |
| `packages/cesr/src/serder/serdery.ts`     | `reapSerder` hydrates the body once, including native fields.                                                                                |
| `packages/cesr/src/annotate/render.ts`    | Annotation-only token walking and rendering.                                                                                                 |
| `packages/keri/src/app/parsering.ts`      | `collectAttachments` projects parsed values into runtime envelopes without decoding their bytes again.                                       |

`CesrFrame` is `{ body, attachments }`. `ParseEvent` is a frame or error emission.
A `GroupTuple` is an ordered recursive tuple, not necessarily a flat primitive
array. `OpaqueSpan` holds original bytes and their domain for opaque wire families;
it is not a qualified primitive.

## Follow one synchronous frame

1. `feed` appends bytes and calls `drain`.
2. `parseFrameStart` reads any selector and dispatches to Serder or a bounded
   body/enclosure reader. It returns the frame genus separately from the explicit
   stream selection.
3. A complete enclosure can emit immediately. Otherwise the stream keeps a
   pending frame and calls `parseAttachments` on available trailing bytes.
4. A following body, a closed attachment-set enclosure, or terminal `flush`
   completes the pending frame. Exhausting a chunk does not.
5. Runtime envelopes reuse the Serder and typed attachment values. Public
   caller-supplied frames still undergo role checks. Descriptor views whose
   classes differ are constructed from existing Matter instances, not qb64 bytes.

## Version and boundary rules

- `gvrsn` is CESR genus; `pvrsn` is message protocol. They are distinct layers.
- A selected genus controls attachment decoding exactly once. Unknown codes and
  malformed primitives do not cause cross-major retries.
- A null stream selection permits legacy frame-start inference. An explicit
  selector persists; enclosure selectors remain local to their bounded scope.
- V1 signature/tuple counters count items. V2 counters count payload quadlets
  (`txt`) or triplets (`bny`). Sized v1 wrappers also count payload units.
- Synchronous enclosure readers wait for the full payload. Progressive frame
  readers descend into a bounded scope immediately; both reject an impossible
  child extent with `GroupSizeError`, never borrowing bytes from the next group.
- Known roles hydrate narrow primitives such as Siger, Verfer/Cigar, NumberPrimitive,
  Diger, and Texter. Preserve canonical wire family names from the pinned codex.
- Opaque wire families preserve one span. Malformed wrappers are errors, not
  opaque recovery paths. Non-native opaque body handling remains a separate,
  explicit behavior after recognized metadata has passed genus validation.

## Adding a group

Check the pinned KERIpy source first. Add the direct handler entry to
`HANDLERS_V1` or `HANDLERS_V2`; use the existing tuple helpers only for actual
fixed tuples. Nested or variable shapes deserve a small named reader. Do not add
schemas that compile into handlers, fallback policies, observers, or compatibility
modes.

Validate real wire bytes in both domains, correct count units, narrow primitive
roles, and enclosure boundaries. Lifecycle changes also require split-stream
coverage and a contract update. Generated tables target KERIpy
`450ae1c2a7eac61d92bc7b830cb6883c41e6a798`; live CLI interop uses
`98b88cf73a746813a8719f05264400467a474c05`. Ordinals follow its Number reader,
including compact codes and fixed-width `0A`. Changing either baseline is a
coordinated interop task.

## Simplification migration

These are deliberate API cuts; old keri-ts APIs need no compatibility aliases.
Protocol compatibility remains required across supported KERI/CESR/ACDC versions.

| Previous surface                                                     | Current surface                                                   |
| -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `CesrMessage` payload                                                | `CesrFrame`                                                       |
| Old `CesrFrame` frame/error union                                    | `ParseEvent`                                                      |
| `AttachmentItem`, `QualifiedPrimitive`                               | Use `GroupEntry` and `Primitive`                                  |
| `PrimitiveTuple`, `isPrimitiveTuple`                                 | `GroupTuple`, `isGroupTuple`                                      |
| `PrimitiveDomain`, repeated `"txt" \| "bny"` aliases                 | `CesrDomain`                                                      |
| `UnknownPrimitive` parser output                                     | `OpaqueSpan.raw` and `.domain`; no invented qualified-code fields |
| `parseAttachmentDispatch`, compatibility forwarding helpers          | `parseAttachmentGroup`                                            |
| Parser strict/compat options and diagnostic observers                | Removed; malformed selected-version input is an error             |
| `ParserState`, separate stream/deferred lifecycle objects            | Private state directly on `CesrParser`                            |
| `FrameParser`, `AttachmentCollector`                                 | `parseFrameStart`, `parseAttachments`                             |
| Attachment dispatch specs, descriptor factories, minor-zero registry | Direct `HANDLERS_V1` and `HANDLERS_V2` maps                       |
| `CesrBody.native`, Serder native token sidecar                       | Hydrated Serder; annotation walks tokens when requested           |
| Runtime dispatch `fromQb64bTuple` factories                          | Construct primitives at raw-input boundaries and use `fromTuple`  |
| Parser-related CLI `--compat`                                        | Removed; unrelated Tufa store/path compatibility remains          |

Internal vocabulary is deliberately short: `readFrameCounter`, `bodyGenus`,
`parseFrame`, `parseFrames`, `parseEnclosedFrame`, `parseNativeBody`,
`parseWrappedBody`, `parseSizedGroup`, `parsePathSigs`, `parseTransSigsV1/V2`,
`tokenSize`, and `unitBytes`. The version suffix on a handler communicates a real
count-unit distinction. Long protocol counter names remain canonical.
