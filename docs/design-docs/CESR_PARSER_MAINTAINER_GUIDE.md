# CESR Parser Maintainer Guide

## Purpose

This document is the maintainer-oriented map for the CESR parser and annotation
stack in `packages/cesr`. It focuses on readability, extension points, and
invariants that should stay stable as we push toward full KERIpy parity.

## Module map

- `packages/cesr/src/core/parser-engine.ts`
  - Streaming frame parser (`CesrParserCore`) for message-domain and CESR-native
    body-group streams.
  - Handles chunk boundaries, pending frames, and attachment continuation.
- `packages/cesr/src/parser/group-dispatch.ts`
  - Counter-group dispatch for attachment/body groups.
  - Versioned dispatch maps (`V1_DISPATCH`, `V2_DISPATCH`) and compatibility
    fallback.
- `packages/cesr/src/primitives/mapper.ts`
  - Strict parsing for map-oriented native groups (labels interleaved with
    values).
  - Recursive map composition support (`children` fields).
- `packages/cesr/src/annotate/render.ts`
  - Human-readable annotated output for parsed frames.
  - Resilient wrapper rendering with explicit opaque fallback comments.
- `packages/cesr/src/primitives/labeler.ts`
  - Label primitive (`V`/`W`) parsing and shared `isLabelerCode()` helper.

## Parse flow (high-level)

1. `CesrParserCore.feed()` appends bytes and calls `drain()`.
2. `drain()` repeatedly:
   - consumes annotation separator bytes (`ano`),
   - parses a base frame (`parseFrame()`),
   - appends attachment groups until the next message boundary or shortage.
3. `parseFrame()` chooses one of:
   - message-domain serder (`reapSerder`),
   - body-with-attachments wrapper,
   - non-native body group,
   - native fixed/map body groups.
4. Attachment groups are decoded by `parseAttachmentGroup` ->
   `parseAttachmentDispatch(Compat)`.
5. Annotation layer renders parsed structures into line-oriented, commented CESR
   text.

## Invariants to preserve

- Chunk-safety:
  - `ShortageError` means "need more bytes", never silent data loss.
- Boundary exactness:
  - group payload sizes must match counter-declared lengths.
- Compatibility behavior:
  - `parseAttachmentDispatchCompat()` may switch major version on
    unknown/deserialize errors.
  - this is intentional for mixed real-world streams.
- Native map strictness:
  - dangling labels must throw.
  - offset must end exactly at payload boundary.
- Annotation resilience:
  - unexpected nested wrapper tails should render as opaque payload lines, not
    crash the tool.

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
3. Register group handling in `group-dispatch.ts`:
   - use `repeatTupleParser(...)` where possible,
   - add dedicated parser only when structure is nested/variable.
4. Extend parser-native extraction if field-level rendering is required.
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

- `deno task cesr:annotate --in <stream.cesr> [--out <file>] [--qb2] [--pretty]`
- `--pretty` only applies to JSON serder message bodies.
- Non-JSON or malformed JSON bodies are emitted as-is.
