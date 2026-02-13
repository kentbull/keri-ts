# CESR Parser Consolidated Plan and Results

## Scope and Source Plans

This document condenses and de-duplicates the parser planning content from:

- `docs/design-docs/codex-plan.md`
- `docs/design-docs/my-cesr-plan.md`
- `docs/design-docs/CESR_IMPLEMENTATION_ANALYSIS_COMPOSER.md`
- `docs/design-docs/CESR_IMPLEMENTATION_ANALYSIS_GPT5Codex.md`
- `docs/design-docs/CESR_IMPLEMENTATION_ANALYSIS_GROK.md`
- `docs/design-docs/CESR_IMPLEMENTATION_ANALYSIS_Sonnet.md`
- `docs/design-docs/CESR_ANNOTATION_PLAN.md`

## Consolidated Design Goals

1. Deliver a full CESR parser package as a reusable kernel, independent from event-processing logic.
2. Reach high parity with KERIpy/SignifyTS/parside behavior for primitives, group dispatch, and framing.
3. Support CESR v1 and v2, including real-world mixed-version edge streams.
4. Support both text and byte domains (`qb64`/`qb2`) with strict structural validation.
5. Provide deterministic incremental parsing across arbitrary chunk boundaries.
6. Keep parser core runtime-agnostic, then provide thin async/Effection adapters.
7. Add human-usable stream annotation tooling for inspection and debugging.

## Consolidated Architecture

### Layered Model

1. **Primitives layer**: matter/counter/indexer and related CESR primitives.
2. **Group-dispatch layer**: counter-driven parsing for attachment/body groups.
3. **Core parser engine**: incremental state machine that emits frames/errors.
4. **Adapters layer**: async iterable + Effection wrappers over the sync core.
5. **Router contract layer**: stub only in parser phase; no event processing coupling.

### Parser/Router Decoupling

- Parser emits normalized frame structures.
- Router concerns are intentionally externalized to a separate contract/stub.

## Consolidated Functional Requirements

1. **Cold-start and version handling**

- Sniff stream domain from first tritet/cold code.
- Parse and validate version strings (v1/v2 forms).
- Use version-appropriate code tables; fail fast on unknown/invalid structures.

2. **Body parsing**

- Parse JSON/CBOR/MGPK bodies using exact size boundaries from smelled metadata.
- Parse CESR-native body groups, including map/list and label-interleaving paths.

3. **Attachment parsing**

- Counter-driven dispatch for known group families.
- Nested/wrapper parsing paths with explicit behavior for opaque fallback cases.
- Mixed-version compatibility mode with observable fallback signaling.

4. **Primitive coverage**

- Implement core KERIpy-relevant primitive classes/codex paths used by parser/group decoding.
- Ensure both text and qb2 parse paths where applicable.

5. **Error model**

- Typed errors for shortage, cold start, version, unknown code, size/group mismatch, and deserialize failures.
- Strict-by-default behavior; recovery only at explicit compatibility boundaries.

6. **Tooling and UX**

- `cesr:annotate` CLI that reads input stream and emits annotated output to stdout or file.
- Optional JSON pretty output mode.

## Consolidated Test Strategy

1. Unit tests for primitive parsing and strict invariants.
2. Unit tests for group dispatch and versioned counter handling.
3. Parser tests for malformed streams and strict fail-fast behavior.
4. qb64/qb2 parity tests across primitives and dispatch paths.
5. External fixture equivalence tests (KERIpy/parside/decoder vectors).
6. Chunk-boundary fuzz/split matrix tests for determinism.
7. Annotator tests for readable output and regression cases.

## Why `feed()/flush()` Sync State Machine Core

The plans considered generator-forward designs, but parser implementation converged on a sync state machine core with `feed()`/`flush()`, then adapter wrappers. This is a standard and defensible protocol-parser architecture.

Well-known references with the same lifecycle pattern:

1. `http-parser` / `llhttp` (incremental execute + final completion).
2. SAX-style parsers such as `sax-js` (push chunks, then close/end).
3. Expat XML parser (`XML_Parse` in repeated chunk calls with final EOF signal).
4. YAJL incremental JSON parsing (`yajl_parse` + `yajl_complete_parse`).
5. RapidJSON SAX `Reader` incremental stream consumption.
6. zlib streaming codecs (`update`/`flush`-style incremental finalization pattern).

Rationale for CESR specifically:

- CESR is framing-heavy and boundary-sensitive.
- Chunk determinism and partial-input handling are first-order concerns.
- Sync core is easier to test exhaustively; async/Effection become thin transport adapters.

## Results (What Was Created and Why)

### What was created

1. A full CESR parser kernel package under `packages/cesr` with:

- Incremental parse engine (`feed()` / `flush()`).
- Versioned group dispatch and attachment parsing.
- Native body-group handling and strict boundary checks.

2. Broad primitive implementation set required for parser parity:

- Counter/matter/indexer and mapper/labeler/texter/pather plus related classes.
- qb64 and qb2 decode paths.

3. Compatibility controls:

- Strict vs compat attachment dispatch behavior.
- Mixed-version fallback signaling hooks.

4. Hardening and parity artifacts:

- External fixture tests.
- qb2 parity tests.
- Chunk/split fuzz matrix tests.
- Primitive parity checklist artifact.

5. Human annotation tooling:

- `cesr:annotate` CLI for converting raw CESR streams into readable annotated output.
- `--in`, `--out`, `--qb2`, and `--pretty` support.

### Why it was created

1. Establish CESR as a stable, publishable foundation layer before KERI event processing and escrow workflows.
2. Create a reliable cross-language parity base against KERIpy/parside behavior.
3. Make CESR streams debuggable by humans via annotation output.
4. Ensure parser behavior is deterministic and robust under real-world streaming/chunking conditions.
