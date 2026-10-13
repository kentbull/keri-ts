# CESR Parser Maintainer Guide

The parser has one progressive engine. The
[state-machine contract](CESR_PARSER_STATE_MACHINE_CONTRACT.md) defines completion
and genus selection; the [progressive contract](CESR_PROGRESSIVE_PARSER_CONTRACT.md)
defines payload ownership and limits.

## Read the code in this order

| Module                                    | Responsibility                                                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `packages/cesr/src/parser/progressive.ts` | Generator locals own nested progress and scoped genus; `yield*` emits complete GenericGroup children early. |
| `packages/cesr/src/parser/cursor.ts`      | Segmented input, bounded scopes, cancellation, and input limits.                                            |
| `packages/cesr/src/parser/body.ts`        | Hydrate one admitted native, non-native, or opaque body.                                                    |
| `packages/cesr/src/parser/attachments.ts` | Direct v1/v2 handlers hydrate finite attachment leaves and known primitive roles.                           |
| `packages/cesr/src/parser/essr.ts`        | Await payload sinks while streaming ESSR wire and expose reopenable wire/raw views.                         |
| `packages/cesr/src/parser/complete.ts`    | Collect finite input with the same engine and release all collected payloads on failure.                    |
| `packages/cesr/src/adapters/effection.ts` | Optional scope-owned frame stream; abort and join source cleanup before releasing input.                    |
| `packages/cesr/src/parser/common.ts`      | Frame-family names, default genus, and selector code.                                                       |
| `packages/cesr/src/core/domain.ts`        | Text/binary token and count-unit widths.                                                                    |
| `packages/cesr/src/serder/serdery.ts`     | Hydrate the body once, including native fields.                                                             |
| `packages/cesr/src/annotate/render.ts`    | Annotation-only token walking and rendering.                                                                |
| `packages/keri/src/app/parsering.ts`      | Project parsed values into runtime envelopes without decoding their bytes again.                            |

`CesrFrame` contains `body`, ordinary `attachments`, and an optional owned `essr`
payload. Errors reject parsing. A `GroupTuple` is an ordered recursive tuple;
`OpaqueSpan` holds original wire bytes and their domain.

## Follow one frame

1. Pull `parse(source, options)` for the next complete frame. The cursor reads
   input on demand; empty chunks and chunk boundaries do not complete messages.
2. Read a selector or body, then traverse attachments inside exact bounded scopes.
   GenericGroup children can finish before their siblings arrive. A
   BodyWithAttachmentGroup must contain exactly one frame before it can yield.
3. Finish an open attachment set at a following body, a closed attachment
   enclosure, or valid source EOF. A partial terminal token rejects the parse.
4. Finish any ESSR stage immediately before delivery. The caller now owns that
   frame's payload and must discard it after consumption. Cancellation releases
   undelivered stages and joins cooperative input cleanup.
5. Runtime envelopes reuse hydrated body and attachment values. Runtime dispatch
   owns authorization and verification; parsing alone accepts no protocol event.

Use `parseBytes(bytes, options)` for finite collection. Its default 8 MiB input
budget is separate from per-frame limits; successful callers own all returned
payloads. A later failure discards every collected frame's payload before rejecting.

## Version and boundary rules

- `gvrsn` is CESR genus; `pvrsn` is message protocol. They are distinct layers.
- A selected genus controls attachment decoding exactly once. Unknown codes and
  malformed primitives do not cause cross-major retries.
- Null selection permits legacy frame-start inference. An explicit selector
  persists; enclosure selectors remain local to their bounded scope.
- V1 signature/tuple counters count items. V2 counters count payload quadlets
  (`txt`) or triplets (`bny`). Sized v1 wrappers also count payload units.
- An impossible child extent is a `GroupSizeError`; no reader borrows bytes from
  the next group. Ordinary leaves are finite admitted values; ESSR transfers are
  separately bounded and awaited.
- Known roles hydrate narrow primitives such as Siger, Verfer/Cigar,
  NumberPrimitive, Diger, and Texter. Preserve canonical protocol counter names.
- Malformed wrappers are errors, not opaque recovery paths. Non-native opaque
  bodies remain an explicit behavior after metadata passes genus validation.

## Adding a group

Check the pinned KERIpy source first. Add a direct `HANDLERS_V1` or `HANDLERS_V2`
entry for a finite leaf. Structural wrappers belong to progressive traversal;
payload transfers belong to the ESSR sink path. Use tuple helpers for actual
fixed tuples, with small named readers for nested or variable shapes.

Validate real text and binary wire, count units, primitive roles, enclosure
bounds, and split input. Update the lifecycle contract when behavior changes.
Generated tables target KERIpy `450ae1c2a7eac61d92bc7b830cb6883c41e6a798`;
[the interop guide](../../../packages/keri/test/README.md) records the live fork
pin and its exact upstream provenance. Changing either baseline is a coordinated
protocol task.

## Deliberate cuts

There is no synchronous stream engine, push API, frame/error event wrapper, or
atomic ESSR adapter. New sources start new parser invocations. Keep ordinary
attachment dispatch in direct maps; do not restore descriptor factories,
version fallback, observers, or aliases for old keri-ts APIs. Supported
KERI/CESR/ACDC v1/v2 wire behavior remains required.
