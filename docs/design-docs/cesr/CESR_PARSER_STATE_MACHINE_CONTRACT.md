# CESR Parser State Machine Contract

## Status

- Created: 2026-02-28
- Scope:
  - `packages/cesr/src/core/parser-engine.ts`
- Architecture:
  - Atomic bounded substream parser
    (`docs/adr/adr-0001-parser-atomic-bounded-first.md`)
- Contract strictness:
  - Normative and test-mapped. Behavior changes require updates to this document
    and mapped tests.

## Purpose

Define the normative parser state machine for `CesrParser` so maintainers can
reason about lifecycle behavior without re-deriving rules from control flow.

## Terminology (Normative)

- Frame: one parser emission unit (`CesrFrame` event with `type: "frame"`).
- `CesrMessage`: historical public payload type name for that frame unit
  (`body` + `attachments`), retained for API compatibility.
- Message-domain frame: frame whose body starts with cold-start code `msg` and
  is parsed through Serder reaping.
- Body group: counter-declared frame-start payload form that defines or encloses
  frame body bytes (`GenericGroup`, `BodyWithAttachmentGroup`, native fixed/map
  groups).
- Attachment group: post-body trailing group parsed by attachment dispatch.
- Annotation separator byte (`ano`): delimiter byte consumed between parse
  units, not itself a frame payload unit.
- Open frame: a parsed body whose trailing attachment set has no proven end.
- Complete enclosure: `BodyWithAttachmentGroup`, `GenericGroup`, or a trailing
  `AttachmentGroup` (including big forms). Individual signature/receipt groups
  bound only their own payloads, not the whole frame.

## State and Completion

`CesrParser` owns the stream buffer, consumed offset and version, one `pending`
open frame, and `queued` complete siblings returned by a `GenericGroup`.
There is no customizable frame-boundary policy or separate deferred-state object.

An open frame completes only at:

1. a following message/body boundary;
2. the end of an enclosure defining the entire frame or attachment set; or
3. explicit `flush()` at the end of a complete record or stream.

Exhausting a network chunk never completes an open frame, even after one or
more fully parsed attachment groups. Initial and resumed attachment collection
use the same code. Annotation separators do not close frames.

## Lifecycle (Normative)

| Operation                 | Behavior                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `feed(chunk)`             | Append bytes, resume pending attachments, emit queued complete frames, then parse new bodies in order.                   |
| Open body parsed          | Consume the body and retain it as `pending`; collect all following attachments until a completion boundary or shortage.  |
| Complete enclosure parsed | Return complete frames in stream order; queue any siblings before parsing outside the enclosure.                         |
| Transport shortage        | Retain the unfinished bytes and pending frame for the next feed.                                                         |
| `flush()`                 | Drain all complete frames regardless of `framed`; finalize an open frame only if no incomplete attachment remains.       |
| Terminal shortage         | Emit one `ShortageError`, discard the incomplete pending frame and remaining bytes, preserve earlier complete emissions. |
| Other parse error         | Emit one error and reset parser state.                                                                                   |
| `reset()`                 | Clear buffer, pending frame and queued frames; clear genus selection and reset offset.                                       |

Repeated `flush()` calls are idempotent. A closed enclosure cannot absorb
attachments outside its declared boundary. Complete bounded payloads containing
incomplete inner items/frames raise `GroupSizeError`; additional network bytes
cannot repair them.

The offset advances only through stream consumption, until reset. Nested groups
remain atomic: the parser waits for the entire counted payload before parsing
it. Native body success requires full `Serder` hydration, not metadata alone.

Complete-record callers (HTTP requests/responses, locally serialized messages,
and queued runtime ingress) must finish parsing with `flush()` or the existing
`Reactor.processCompleteChunk()`. Raw streaming callers use `feed()` or
`Reactor.processChunk()` and retain state across network chunks.

## Attachment Count Units

Count semantics follow the selected CESR genus version, independently of the
message protocol version. The reference for this correction is KERIpy commit
`927c0cb8794d7c84fc17143c67df64aab9deda6c`, `core/counting.py` (`Counter.enclose`)
and `core/parsing.py` (versioned attachment handlers).

| Group family                                                                           | v1                        | v2                                      |
| -------------------------------------------------------------------------------------- | ------------------------- | --------------------------------------- |
| Controller/witness signatures, receipt/replay/seal tuples                              | Item count                | Payload quadlets/triplets               |
| Transferable and last-establishment signature groups, including nested signature lists | Item count at each level  | Payload quadlets/triplets at each level |
| v2-only seal, blinded-state, bound-state, and media tuples                             | Not applicable            | Payload quadlets/triplets               |
| Enclosures/wrappers                                                                    | Payload quadlets/triplets | Payload quadlets/triplets               |
| Genus-version selector                                                                 | Version value             | Version value                           |

V2 payload lengths exclude the counter header. Each v2 group is bounded before
its items are parsed, and success consumes that exact boundary. A count of 22
can therefore contain one 88-character signature; `Counter.count` stays 22,
while the hydrated item list has length one. Primitive sizes determine item
boundaries; there is no fixed signature-size assumption.

If fewer bytes than the declared payload have arrived, parsing raises
`ShortageError` and waits. Once that payload is complete, an incomplete inner
primitive, tuple, or nested group is a `GroupSizeError`: following bytes cannot
repair it. Strict and compat wrapper modes both propagate this boundary error.
Old v2 fixtures that used item counts are invalid; no fallback accepts them.

Coverage: `packages/cesr/test/unit/parser-count-units.test.ts` and the KERI
`protocol-serialization.test.ts` serializer-to-parser regression, plus the
existing version-selector, wrapper, and split-stream suites.

## Version Context Semantics

`FrameParser` owns genus selection. The stream retains only an explicit selector;
`streamVersion = null` means no selection has been made. Frame `version` is the
resolved genus for counters and attachments, never the body's protocol version.

- A top-level `KERIACDCGenusVersion` selects the genus for subsequent frames
  until another selector or reset. It survives chunk boundaries and v1 bodies.
- Body `pvrsn` and `gvrsn` stay as encoded. As in pinned KERIpy `Serdery.reap`,
  protocol major must not exceed stream genus major; a declared body genus must
  be supported and must not exceed the stream genus major or minor.
- Enclosures pass their resolved genus to child parsing. Inner selectors affect
  subsequent siblings in that enclosure, never the enclosing stream. Attachment
  wrappers likewise keep their selectors local.
- With no selector or enclosing genus, bare v1 bodies infer genus 1.0; other
  bodies use their declared genus or the default 2.0. This is the explicit
  legacy compatibility path, not a claim that protocol and genus are equal.
  Inference does not lock the next unselected frame to that version.
- Alternate-major frame-counter recognition is allowed only at an unselected
  stream head. Boundary lookahead and native token probes use the resolved genus
  once. Selected streams and enclosed payloads never retry under another major.
- Non-native opaque-body recovery cannot hide a recognized header's version
  incompatibility. Strict and compat modes obey the same genus rules.

Selectors use one major sextet plus two minor sextets; `decodeGenusVersion()`
remains the sole decoder. Fixtures use `Counter.makeGVC()` except when testing
invalid encodings. No global nested version stack or version policy is needed.

Coverage: `packages/cesr/test/unit/parser-genus-context.test.ts` checks explicit
v2 genus with v1 bodies and v2 attachments, nesting, incompatible bodies and
counters, both minor sextets, reset, and text/binary chunk partitions.

## Attachment Version Selection

Attachment dispatch uses the selected genus version once. Unknown counter codes,
deserialization failures, and invalid primitives must not trigger a retry under a
different major version. In particular, malformed v1 `ControllerIdxSigs` must not
be accepted as an opaque v2 `GenericGroup` because both use `-A`.

Strict/compat mode controls wrapper-tail recovery only. Explicit scoped
`KERIACDCGenusVersion` selectors remain supported. Frame-start recognition and
legacy implicit-v1 behavior are separate from attachment dispatch.

Regression coverage: `test/unit/parity.test.ts` exercises selected-version
rejection in both modes and both text/binary domains; `test/unit/parser.test.ts`
checks that the default parser emits an error rather than a frame for malformed
v1 signatures. Paths are relative to `packages/cesr`.

## Framed vs Unframed

`framed=true` emits at most one complete frame per `feed()` call;
`framed=false` emits all available complete frames. Both use identical frame
completion rules. `flush()` drains everything in either mode. This flag controls
emission cadence, not whether the caller supplied a complete transport record.

## Contract-to-Test Matrix

| Contract Item                                                             | Test Coverage (under `packages/cesr/test`)                                                                                             |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Every byte split, bytewise feeds, empty feeds, v1/v2 and text/binary      | `unit/parser-chunk-completion.test.ts`                                                                                                 |
| Enclosures close promptly and exclude outside attachments                 | `unit/parser-chunk-completion.test.ts`                                                                                                 |
| Partial attachments cannot emit incomplete frames                         | `unit/parser-chunk-completion.test.ts`, `unit/parser-flush.test.ts`                                                                    |
| Flush drains complete siblings before terminal shortage and is idempotent | `unit/parser-flush.test.ts`                                                                                                            |
| Framed emission cadence                                                   | `unit/parser-framed-mode.test.ts`                                                                                                      |
| GenericGroup atomic parsing and split determinism                         | `unit/parity-generic-group.test.ts`                                                                                                    |
| Version scopes, selectors, implicit v1 and wrapper scopes                 | `unit/parser-version-context.test.ts`, `unit/parser-wrapper-version-context.test.ts`, `unit/parser-legacy-v1-implicit-version.test.ts` |
| Mixed frame order and error reset                                         | `unit/parser-mixed-stream.test.ts`, `unit/parser-recovery.test.ts`                                                                     |
| Native hydration                                                          | `unit/external-fixtures.test.ts`, `hardening/parser-native-body-breadth.test.ts`                                                       |

Runtime complete-record versus raw-stream coverage:
`packages/keri/test/unit/app/reactor.test.ts`.

## Change Control

Any parser lifecycle change that affects:

- deferred emission ordering,
- shortage behavior,
- version-scope transitions,
- framed/unframed branch behavior,

must update this contract and the mapped tests in the matrix.

## Attachment Version Boundaries

- ESSR v1 counts Texter items; ESSR v2 counts payload quadlets (text) or triplets
  (binary). Both hydrate Texters before KERI envelope normalization.
- Genus selectors carry one major sextet and two minor sextets. Unsupported
  versions fail without coercion or compat-wrapper recovery.
- Transferable signature groups require the selected version's ControllerIdxSigs
  counter internally. Witness counters and big inner counters are rejected to
  match the pinned KERIpy parser; top-level big signature counters remain valid.
- Generated codex tables target KERIpy
  `450ae1c2a7eac61d92bc7b830cb6883c41e6a798`, also pinned by PR interop CI.
  `KERIPY_PATH` must identify a Git repository containing that revision; table
  generation reads committed blobs, independent of the checkout's current HEAD.
  Updating this baseline requires reviewing reused code meanings together with
  parser, serializer, fixture, and interop changes.
