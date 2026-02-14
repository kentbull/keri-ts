# CESR Annotation Plan (txt + qb2)

## Goal

Given an arbitrary CESR stream (text or binary), produce a deterministic,
human-readable annotated CESR stream with indentation and comments, suitable for
debugging and translation.

## Hard Requirement: CLI UX (JQ-like for CESR)

From the command line in `keri-ts`, we must support piping CESR text input and
getting annotated output to:

1. `STDOUT` by default
2. A specified output file when requested

The UX target is analogous to `jq` for JSON streams, but for CESR streams.

Minimum CLI shape:

- `deno task cesr:annotate` (reads stdin, writes stdout)
- `deno task cesr:annotate --in <path>` (reads file, writes stdout)
- `deno task cesr:annotate --out <path>` (reads stdin/file, writes file)
- `deno task cesr:annotate --qb2` (treat input as binary domain bytes)

## Reference Baseline

- KERIpy implementation: `keripy/src/keri/core/annotating.py`
- KERIpy tests: `keripy/tests/core/test_annotating.py`

Observed baseline and gaps:

1. KERIpy has `annot()`/`denot()` behavior for text CESR.
2. KERIpy binary-domain annotation path is unfinished (`cold == bny` branch
   effectively unimplemented).
3. KERIpy annotation is event-field heavy and not a complete generic CESR
   annotator.

Our implementation in `keri-ts` closes these gaps by building annotation on top
of the existing parser engine and primitives, with full txt + qb2 coverage.

## Architecture

Implement annotation as a formatter layer, not a second parser.

1. Parse input using existing CESR parser (same strict semantics).
2. Transform parser emissions into a structured annotation tree.
3. Render tree to deterministic annotated text.
4. Optionally de-annotate (`denot`) back to raw stream bytes.

Proposed module layout:

- `packages/cesr/src/annotate/annotator.ts`
- `packages/cesr/src/annotate/render.ts`
- `packages/cesr/src/annotate/comments.ts`
- `packages/cesr/src/annotate/types.ts`
- `packages/cesr/src/annotate/denot.ts`
- `packages/cesr/src/annotate/cli.ts` (or integrate with existing CLI entry)

## Public API

1. `annotate(input: Uint8Array | string, opts?: AnnotateOptions): string`
2. `annotateFrames(input: Uint8Array | string, opts?: AnnotateOptions): AnnotatedFrame[]`
3. `denot(annotated: string): Uint8Array`

Initial options:

- `commentMode: "inline" | "above"` (default `inline`)
- `indent: number` (default `2`)
- `showOffsets: boolean` (default `false`)
- `showRawHex: boolean` (default `false`)
- `domainHint: "txt" | "bny" | "auto"` (default `auto`)

## Rendering Rules

1. Each group code introduces a new indentation level (+2 spaces).
2. Each primitive is rendered with a semantic comment:
   - right-side inline comment by default
   - optional comment-above mode
3. Native body groups and nested maps preserve hierarchy and label semantics.
4. Output must be deterministic regardless of stream chunk boundaries.
5. qb2 input is parsed in binary domain and rendered as canonical textual
   annotated output for human readability.

## No Magic Strings Policy

All annotation labels/comments come from centralized registries:

1. Primitive code metadata registry
2. Counter/group code metadata registry
3. Native field label registry (`v`, `t`, `d`, etc.)

No repeated inline literals in parser/renderer control flow.

## Error Handling Policy

Annotation uses strict parser behavior:

1. Fail-fast on malformed streams.
2. Include byte offset and parser state context in thrown errors.
3. No silent error suppression in annotation pipeline.

## Test Plan

### KERIpy Fixture Parity

1. Port vectors from `keripy/tests/core/test_annotating.py`.
2. Golden tests for text annotation output.
3. Roundtrip tests: `denot(annotate(raw)) == raw`.

### qb2 Parity and Native Fidelity

1. Add qb2 fixtures for attachment groups and native body-group paths.
2. Validate identical semantic annotation for equivalent txt vs qb2 payloads.
3. Ensure MapBodyGroup label interleaving and nested mapper structures are fully
   preserved.

### Split/Chunk Determinism

1. Full split-fuzz matrix across representative fixture corpus.
2. Random chunking stress runs with deterministic output assertions.

### CLI Tests

1. stdin -> stdout happy path
2. file -> stdout
3. stdin/file -> out file
4. invalid stream returns non-zero exit with typed error summary

## Execution Order

1. Add annotation types, comment registries, and renderer.
2. Implement `annotate()` over existing parser emissions.
3. Implement `denot()` and roundtrip tests.
4. Add CLI command/task with stdin/stdout/file handling.
5. Port KERIpy fixtures and lock goldens.
6. Add qb2/native fidelity and chunk-fuzz hardening.
7. Expand fixture corpus for external parity at scale.

## Definition of Done

1. Any CESR input stream (txt or qb2) can be annotated deterministically.
2. CLI supports jq-like stream workflow (`stdin -> stdout`) and file output
   mode.
3. `denot(annotate(x)) == x` across fixture corpus.
4. KERIpy annotation fixtures pass where applicable; qb2 parity covered with new
   fixtures.
5. No magic strings in annotation logic; registries are single source of truth.
6. All tests pass.
