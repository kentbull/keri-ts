# CESR Parser Progress Summary (2026-02-13)

## Why This Matters

This work established the foundational CESR kernel for `keri-ts`: parser core,
primitive decoding, group dispatch, qb64/qb2 parity paths, and a human-facing
annotator CLI. This is the substrate required before building higher-level KERI
runtime infrastructure (controller runtime, mailbox, witness, watcher, observer,
registrar, adjudicator).

## Executive Summary

At the start of this effort, `keri-ts` did not have a complete CESR parser stack
with reliable stream parsing, group dispatch, native body handling, and
operational annotation tooling.

As of this summary, `keri-ts` now has:

- A streaming CESR parser with chunk/split-boundary determinism.
- Attachment and body-group dispatch across major CESR pathways.
- qb64 and qb2 parsing parity for implemented primitives/groups.
- Native CESR body parsing (including map-body label interleaving behavior).
- Legacy compatibility handling for SadPath-related v1 counter aliases used in
  real streams.
- A working `cesr:annotate` CLI that annotates raw CESR streams to
  human-readable output.
- Extensive unit/fixture/fuzz-style tests with currently green suites.

## Major Delivered Capabilities

### 1. Core CESR Streaming Parser

Primary file:

- `packages/cesr/src/core/parser-engine.ts`

Delivered:

- Stateful streaming parse engine (`CesrParserCore`) with `feed()` / `flush()`.
- Frame emission model (`ParseEmission`) supporting partial chunks.
- Attachment continuation logic for pending frames.
- Native/body-group start parsing for message and CESR-native streams.
- Deterministic handling across chunk boundaries (validated by tests).

### 2. Group Dispatch and Counter-Driven Parsing

Primary file:

- `packages/cesr/src/parser/group-dispatch.ts`

Delivered:

- Versioned dispatch maps for v1/v2 counter groups.
- Tuple/repetition-based group parsers for indexed signatures, receipts, seals,
  etc.
- Wrapper-group nested parsing with explicit opaque fallback behavior when
  needed.
- Compatibility dispatch (`parseAttachmentDispatchCompat`) for mixed-version
  real-world streams.

### 3. Primitive Coverage and Native Decoding

Primary directory:

- `packages/cesr/src/primitives/`

Delivered:

- Broad primitive parser set for matter/indexer/counter and native primitives.
- Map/list/native support helpers (`mapper`, `labeler`, `pather`, `texter`,
  etc.).
- Recursive map-body decoding with strict boundary validation.

### 4. qb2 Byte-Domain Parity

Delivered:

- qb2 support added/extended across primitives and group dispatch paths.
- qb64 vs qb2 parity tests covering currently implemented primitive/group set.
- BodyWithAttachmentGroup/nested-body qb2 pathways exercised by tests.

### 5. CESR Annotator + CLI

Primary files:

- `packages/cesr/src/annotate/annotator.ts`
- `packages/cesr/src/annotate/render.ts`
- `packages/cesr/src/annotate/cli.ts`

Delivered:

- Annotated CESR rendering with group/primitive comments and indentation.
- CLI task:
  - `deno task cesr:annotate --in <file> [--out <file>] [--qb2] [--pretty]`
- JSON pretty-print option for message bodies via `--pretty`.
- Resilient wrapper rendering with explicit opaque payload fallback comments.

### 6. Legacy/Compatibility Paths (SadPath + Aliases)

Delivered:

- Legacy v1 SadPath compatibility routes added where needed for real streams.
- Generator overlay protections so legacy aliases persist across table
  regeneration.
- Parity tests ensuring these compatibility mappings are not silently lost.

## Test and Hardening Status

Current observed status (latest local run in this session):

- `deno task test:cesr` => `80 passed, 0 failed`
- `deno task test:quality` => `97 passed, 0 failed` (server integration test
  intentionally excluded for restricted environments)

Coverage themes already present:

- Parser unit tests.
- qb2 parity tests.
- Native primitives tests.
- External fixture parity tests.
- Chunk/split fuzz matrix tests for boundary robustness.
- Annotator behavior tests.

## Key Files to Read First (TS Audit Path)

### Parser Mechanics

1. `packages/cesr/src/core/parser-engine.ts`
2. `packages/cesr/src/parser/group-dispatch.ts`
3. `packages/cesr/src/parser/attachment-parser.ts`
4. `packages/cesr/src/parser/cold-start.ts`

### Primitive Semantics

1. `packages/cesr/src/primitives/counter.ts`
2. `packages/cesr/src/primitives/matter.ts`
3. `packages/cesr/src/primitives/indexer.ts`
4. `packages/cesr/src/primitives/mapper.ts`
5. `packages/cesr/src/primitives/labeler.ts`

### Serder / Envelope

1. `packages/cesr/src/serder/smell.ts`
2. `packages/cesr/src/serder/serder.ts`
3. `packages/cesr/src/serder/serdery.ts`

### Annotation Tooling

1. `packages/cesr/src/annotate/render.ts`
2. `packages/cesr/src/annotate/annotator.ts`
3. `packages/cesr/src/annotate/cli.ts`

### Tables / Codex / Generation

1. `packages/cesr/src/tables/counter-codex.ts`
2. `packages/cesr/src/tables/counter.tables.generated.ts`
3. `packages/cesr/src/tables/matter.tables.generated.ts`
4. `packages/cesr/scripts/generate-tables.ts`

### Parity Tracking and Fixtures

1. `packages/cesr/docs/parity/primitive-parity-checklist.json`
2. `packages/cesr/test/unit/parity.test.ts`
3. `packages/cesr/test/unit/external-fixtures.test.ts`

## Recommended Python ↔ TypeScript Comparison Workflow

For KERIpy parity review, use this sequence:

1. Compare codex/tables first (counter/matter code names and sizes).
2. Compare primitive parse behavior (counter/matter/indexer).
3. Compare group parser contracts (count semantics, tuple structures, nesting).
4. Compare frame-level parser behavior on chunk boundaries and shortages.
5. Compare native map/fix body handling (labels, recursion, field extraction).
6. Compare compatibility paths (legacy v1/v2 cross-stream cases).
7. Compare annotation semantics/output style.

This order avoids false mismatches caused by higher-level behavior depending on
low-level table/size semantics.

## Quality and Maintainability Work Also Started

To support long-term correctness and maintainability:

- Added architecture and quality-pass planning docs:
  - `docs/design-docs/ARCHITECTURE_MAP.md`
  - `docs/design-docs/CODEBASE_QUALITY_PASS_PLAN.md`
- Added quality gate tasks and static debt reporting:
  - `deno task quality`
  - `deno task quality:report`
- Began Phase 1 error-model unification in app/db layers with typed errors.

## Current Positioning

For the implemented scope, the CESR parser/annotator stack is now substantial,
test-hardened, and suitable as the core kernel for the next layer of KERI
infrastructure development, contingent on continued parity verification against
KERIpy and additional fixture expansion where needed.

## Practical Next Verification Steps

1. Run side-by-side parser output comparisons on representative KERIpy/parside
   vectors.
2. Focus diff review on legacy and nested-group edge cases.
3. Validate annotation output semantics against expected human-readable decoding
   intent.
4. Continue parity checklist closure for any remaining primitive/group edge
   gaps.
