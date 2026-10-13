# CESR Parser Maintainer Guide

## Purpose

This document is the maintainer-oriented map for the CESR parser and annotation
stack in `packages/cesr`. It focuses on readability, extension points, and
invariants that should stay stable as we push toward full KERIpy parity.

Canonical parser lifecycle/state-machine contract:

- `docs/design-docs/cesr/CESR_PARSER_STATE_MACHINE_CONTRACT.md`

## Parser terminology (normative)

- Frame: one parser emission unit (`type: "frame"`) containing one body plus
  zero or more trailing attachment groups.
- `CesrFrame`: historical public type name for the frame payload object
  (`body` + `attachments`); retained for API stability.
- Message-domain frame: frame whose body starts with cold-start code `msg` and
  is parsed via Serder reaping.
- Body group: counter-declared frame-start payload form (`GenericGroup`,
  `BodyWithAttachmentGroup`, or native fixed/map group) that defines or encloses
  the frame body.
- Attachment group: trailing post-body group parsed by attachment dispatch; may
  include nested wrapper groups.
- Annotation separator byte (`ano`): delimiter byte consumed between tokens; not
  a frame payload unit.
- Deferred lifecycle terms: `pendingFrame` is the oldest incomplete top-level
  frame continuation; `queuedFrames` are younger, already-complete enclosed
  frames emitted after the pending frame to preserve stream order.

## Module map

- `packages/cesr/src/core/parser-engine.ts`
  - Streaming frame parser (`CesrParser`) for message-domain and CESR-native
    body-group streams.
  - Handles chunk boundaries, pending frames, and attachment continuation.
- `packages/cesr/src/parser/attachment-parser.ts`
  - Counter-group dispatch for attachment/body groups.
  - Version-selected dispatch with no cross-major retry. Parsing
    rejects malformed wrapper tails; opaque wire families retain one byte span.
- `packages/cesr/src/primitives/mapper.ts`
  - Strict parsing for map-oriented native groups (labels interleaved with
    values).
  - Recursive map composition support (`children` fields).
- `packages/cesr/src/annotate/render.ts`
  - Human-readable annotated output for parsed frames.
  - Token rendering with explicit comments for opaque wire payloads.
- `packages/cesr/src/primitives/labeler.ts`
  - Label primitive (`V`/`W`) parsing and shared `isLabelerCode()` helper.

## Parse flow (high-level)

1. `CesrParserCore.feed()` appends bytes and calls `drain()`.
2. `drain()` repeatedly:
   - consumes annotation separator bytes (`ano`),
   - parses a base frame (`parseFrameStart()`),
   - appends attachment groups until the next frame boundary or shortage.
3. `parseFrameStart()` chooses one of:
   - message-domain Serder frame (`reapSerder`),
   - body-with-attachments wrapper,
   - non-native body group,
   - native fixed/map body groups.
4. Attachment groups are decoded by `parseAttachmentGroup` ->
   `parseAttachmentGroup`.
5. Annotation layer renders parsed structures into line-oriented, commented CESR
   text.

## Invariants to preserve

- Chunk-safety:
  - `ShortageError` means "need more bytes", never silent data loss.
- Boundary exactness:
  - group payload sizes must match counter-declared lengths.
- Version selection:
  - Decode attachments once under the selected genus.
  - Malformed wrapper tails are errors; no cross-major retry or recovery mode.
- Native map strictness:
  - dangling labels must throw.
  - offset must end exactly at payload boundary.
- Annotation resilience:
  - opaque wire families remain renderable; malformed wrapper tails fail.

## Refactoring guidelines

- Prefer short, labeled helpers over long blocks when they reduce cognitive
  load.
- Keep parsing helpers pure (input bytes + version/domain => parsed value +
  consumed bytes).
- Reuse shared helpers for repeated concerns:
  - token sizing by domain (`fullSize` vs `fullSizeB2`),
  - labeler code checks (`isLabelerCode`),
  - recoverable parse-error classification.
- Add comments only where behavior is non-obvious or intentionally permissive.

## Adding new primitives/groups

1. Add codex/table entries (or generator overlays if legacy compatibility is
   needed).
2. Add primitive parser in `packages/cesr/src/primitives`.
3. Register group handling in `attachment-parser.ts`:
   - use `repeatTupleParser(...)` where possible,
   - add dedicated parser only when structure is nested/variable.
4. Extend annotation token rendering if field-level comments are required.
5. Add tests:
   - unit parser test,
   - qb64/qb2 parity,
   - chunk-fuzz split-boundary coverage,
   - annotation rendering expectations where applicable.

## Error handling policy

- Throw for structural violations and boundary mismatches.
- Use typed recovery only at explicit compatibility/recovery points.
- Avoid broad `catch {}` without error classification.

## CLI annotation behavior notes

- `deno task tephra:annotate --in <stream.cesr> [--out <file>] [--qb2] [--pretty]`
- `--pretty` only applies to JSON serder message bodies.
- Non-JSON or malformed JSON bodies are emitted as-is.
