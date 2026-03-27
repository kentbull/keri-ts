# CESR Parser Readability Improvement Plan

## Status

- Created: 2026-02-27
- Updated: 2026-03-02
- Priority: high
- Ten-point progress:
  - Completed: Point 1 (`Publish an explicit parser state machine contract`)
  - Completed: Point 2 (`Decompose CesrParser into focused collaborators`)
  - Completed: Point 3
    (`Replace boolean policy branching with strategy interfaces`)
  - Completed: Point 4
    (`Replace unknown[] attachment payloads with discriminated types`)
  - Completed: Point 5
    (`Convert dispatch definitions to a single declarative spec`)
  - Completed: Point 6
    (`Make recovery behavior explicit, configurable, and observable`)
    - Completed on 2026-03-01 with structured diagnostics contract + observer
      wiring.
  - Completed: Point 7 (`Separate syntax parsing from semantic interpretation`)
    - Completed on 2026-03-01 with targeted frame-start/native-body syntax
      artifact extraction and mapper syntax/semantic split.
  - Completed: Point 9 (`Apply naming and terminology normalization pass`)
    - Completed on 2026-03-01 with glossary-first terminology alignment in
      parser docs and targeted ambiguity-reducing identifier/comment cleanup.
  - Completed: Point 10
    (`Gate performance optimization behind readability-first abstractions`)
    - Completed on 2026-03-01 with baseline parser benchmark flows
      (`deno bench`, reusable benchmark abstraction, and `tufa benchmark cesr`)
      plus rollback-gating criteria in deferred perf plan docs.
  - Completed: Point 8
    (`Add parity-oriented behavioral lock tests against keripy`)
    - Completed on 2026-03-02 with all remaining `V-P2-003`, `004`, `006`,
      `007`, `009`, `010`, `013`, `016`, `020`, `021` hardening vectors
      implemented and passing.
- Scope:
  - `packages/cesr/src/core/parser-engine.ts`
  - `packages/cesr/src/parser/group-dispatch.ts`
  - `packages/cesr/src/parser/attachment-parser.ts`
  - `packages/cesr/src/primitives/mapper.ts`
  - parser types, errors, and tests in `packages/cesr`

## Purpose

This plan defines ten concrete parser-readability improvements for `keri-ts`
CESR parsing, with emphasis on:

- human comprehensibility for maintainers
- defensible design decisions aligned with SOLID and clean-code principles
- preserving real-world CESR compatibility behavior while making that behavior
  explicit

The plan is informed by comparison against `keripy` main
(`keripy/src/keri/core/parsing.py`), while keeping the `keri-ts` architectural
advantage of parse-only responsibilities and no direct event-processing side
effects.

## Current Baseline (Implemented Since Plan Creation)

The parser now includes several concrete behaviors that should be treated as
baseline constraints for readability refactors:

- Point 1 deliverables are complete as of 2026-02-28:
  - canonical lifecycle contract
    (`docs/design-docs/cesr/CESR_PARSER_STATE_MACHINE_CONTRACT.md`)
  - parser lifecycle comments and transition invariants
  - explicit ordering and flush behavior lock tests (including `V-P1-014`)
- Explicit two-track frame lifecycle:
  - `pendingFrame` for in-progress top-level frame continuation across chunk
    boundaries.
  - `queuedFrames` for additional complete enclosed frames extracted from one
    `GenericGroup` payload.
- Bounded enclosed parsing:
  - `parseFrameSequence()` parses all enclosed frames inside one size-bounded
    `GenericGroup` payload slice.
  - `parseGenericGroup()` emits first enclosed frame immediately and queues the
    remainder for deterministic ordered emission.
- Coherent frame contract functions:
  - `parseFrame()` (body-start parse + stream version/context updates),
  - `parseCompleteFrame()` (bounded full frame parse),
  - `resumePendingFrame()` (incremental top-level continuation),
  - `parseFrameSequence()` (bounded enclosed multi-frame sequence parse).
- Version/context behavior:
  - leading genus-version selectors supported at top-level and inside wrappers,
  - legacy implicit-v1 stream handling is lock-tested.
- Recovery and boundary behavior:
  - strict/compat attachment dispatch mode with structured recovery diagnostics
    and legacy fallback callback adapter,
  - `flush()` terminal-shortage idempotency,
  - reset-and-recover behavior lock tests.
- Binary message support:
  - cold-start Serder decode parity support for JSON/CBOR/MGPK bodies
    (library-backed decoding).

These are now part of the intended parser behavior and must remain readable and
explainable through documentation and tests.

## Design Principles

- Single Responsibility: parsing, boundary policy, version fallback, and
  semantic interpretation should not be interleaved.
- Open/Closed: new CESR codes and parser policies should be addable without
  rewriting core control flow.
- Liskov/Interface Segregation: smaller parser interfaces should isolate
  behavior (body parse vs attachment parse vs boundary policy).
- Dependency Inversion: policy choices should be injected, not hard-coded in
  control branches.
- Clean Code: explicit invariants, minimal hidden state, predictable naming, and
  typed domain models.

## Ten-Point Plan

### 1) Publish an explicit parser state machine contract

Status:

- Completed on 2026-02-28.
- Completion evidence:
  - `docs/design-docs/cesr/CESR_PARSER_STATE_MACHINE_CONTRACT.md`
  - `packages/cesr/test/unit/parser-flush.test.ts` (`V-P1-014`, `V-P1-012`,
    `V-P0-008`, `V-P0-009`)
  - parser lifecycle comment/invariant updates in
    `packages/cesr/src/core/parser-engine.ts`

Document and codify parser states, transitions, and emission rules currently
spread across:

- `drain()`
- `parseFrame()`
- `resumePendingFrame()`
- `parseFrameSequence()`
- `flush()`

Deliverables:

- state diagram and transition table in docs
- code comments that state invariant per transition
- removal of parser TODO ambiguity in control flow

Why:

- highest readability gain per line changed
- reduces maintainers needing to infer behavior from nested branches
- makes `pendingFrame` vs `queuedFrames` lifecycle explicit and reviewable

### 2) Decompose `CesrParser` into focused collaborators

Status:

- Completed on 2026-02-28.
- Completion evidence:
  - Collaborator modules added in `packages/cesr/src/core/`:
    - `parser-stream-state.ts`
    - `parser-deferred-frames.ts`
    - `parser-frame-parser.ts`
    - `parser-attachment-collector.ts`
    - `parser-constants.ts`
  - `packages/cesr/src/core/parser-engine.ts` reduced to orchestration-focused
    control flow.
  - Full suite verification in `packages/cesr`: `deno task test`
    (`119 passed, 0 failed`).

Refactor `CesrParser` orchestration to delegate responsibilities to small units:

- stream/cursor state management
- frame start parsing (message, native, wrapped body groups)
- attachment continuation/collection
- version context management
- enclosed-frame queue and emission policy (`GenericGroup` first-vs-rest
  behavior)

Deliverables:

- reduced method size and branch fan-out in `parser-engine.ts`
- collaborator interfaces with tight responsibilities
- dedicated helper or collaborator for queued enclosed-frame lifecycle (to avoid
  drift between pending and queued semantics)

Why:

- keeps the top-level parser readable as control logic rather than
  implementation details

### 3) Replace boolean policy branching with strategy interfaces

Status:

- Completed on 2026-03-01.
- Completion evidence:
  - `packages/cesr/src/core/parser-policy.ts` (`FrameBoundaryPolicy` + default
    framed/unframed strategies)
  - `packages/cesr/src/parser/attachment-fallback-policy.ts`
    (`AttachmentVersionFallbackPolicy` + strict/compat strategy factories)
  - `packages/cesr/src/parser/group-dispatch.ts` (dispatch wiring that
    consumes/re-exports fallback policies)
  - Follow-up API simplification: single factory path
    `createAttachmentVersionFallbackPolicy({ mode, onVersionFallback })`;
    removed redundant strict/compat convenience wrappers.
  - Policy-injected refactors in:
    - `packages/cesr/src/core/parser-engine.ts`
    - `packages/cesr/src/core/parser-frame-parser.ts`
    - `packages/cesr/src/core/parser-attachment-collector.ts`
  - Full suite verification in `packages/cesr`: `deno task test`
    (`118 passed, 0 failed`).

Current behavior gates (`framed`, compat/strict fallback handling) should become
injected policy objects:

- `FrameBoundaryPolicy`
- `AttachmentVersionFallbackPolicy`

Deliverables:

- elimination of policy condition scattering
- one policy implementation for current behavior; additional policies addable
  without parser core edits

Why:

- makes behavior choices explicit and testable in isolation

### 4) Replace `unknown[]` attachment payloads with discriminated types

Status:

- Completed on 2026-03-01.
- Completion evidence:
  - `packages/cesr/src/core/types.ts` (`AttachmentItem` discriminated union +
    `AttachmentGroup.items: AttachmentItem[]`)
  - `packages/cesr/src/parser/group-dispatch.ts` (discriminated payload emission
    for qb64/qb2/tuple/group items and opaque-wrapper-tail tagging)
  - `packages/cesr/src/annotate/render.ts` (discriminant-driven attachment
    rendering)
  - Primitive wrapper type updates:
    - `packages/cesr/src/primitives/sealer.ts`
    - `packages/cesr/src/primitives/blinder.ts`
    - `packages/cesr/src/primitives/mediar.ts`
    - `packages/cesr/src/primitives/aggor.ts`
  - Focused wrapper/version-context tests migrated to discriminant checks.
  - Full suite verification in `packages/cesr`: `deno task test`
    (`118 passed, 0 failed`).

`AttachmentGroup.items: unknown[]` should become typed structures keyed by
attachment kind/code.

Deliverables:

- discriminated union for parsed attachment payloads
- explicit shape for tuple/repeated/wrapper groups
- compatibility-preserving raw-bytes access remains available

Why:

- readers and downstream users can understand payload meaning from types, not
  source spelunking

### 5) Convert dispatch definitions to a single declarative spec

Status:

- Completed on 2026-03-01.
- Completion evidence:
  - `packages/cesr/src/parser/group-dispatch.ts` now defines one canonical
    `ATTACHMENT_DISPATCH_SPEC` descriptor model and derives:
    - major-version dispatch maps
    - wrapper-group code sets
    - siger-list allowance sets
  - Descriptor schema includes version, parser kind, semantic shape, and
    tuple/wrapper/siger metadata.
  - Invariant lock test added:
    `packages/cesr/test/unit/dispatch-spec-invariants.test.ts` validates
    generated table coverage/uniqueness and explicit legacy v1 `-J/-K`
    compatibility allowance.
  - Full suite verification in `packages/cesr`: `deno task test`
    (`118 passed, 0 failed`).

Keep table-driven dispatch, but define groups from one source of truth
(descriptor table), then derive maps.

Deliverables:

- descriptor schema for group code, version, parser kind, and semantic shape
- generated or mechanically built dispatch maps from descriptors

Why:

- minimizes repetition and drift risk in large manual maps
- eases code review for new CESR code additions

### 6) Make recovery behavior explicit, configurable, and observable

Status:

- Completed on 2026-03-01.
- Completion evidence:
  - `packages/cesr/src/core/recovery-diagnostics.ts` (`RecoveryDiagnostic`
    union + diagnostics/callback observer adapter)
  - diagnostics observer wiring in:
    - `packages/cesr/src/core/parser-engine.ts`
    - `packages/cesr/src/core/parser-frame-parser.ts`
    - `packages/cesr/src/core/parser-attachment-collector.ts`
    - `packages/cesr/src/parser/group-dispatch.ts`
  - `packages/cesr/src/parser/attachment-fallback-policy.ts` default warning
    side-effect removal.
  - Focused diagnostics contract tests:
    - `packages/cesr/test/unit/parser-recovery-diagnostics.test.ts`
  - Full suite verification in `packages/cesr`: `deno task test`
    (`132 passed, 0 failed`).

Deliverables:

- `RecoveryDiagnostic` contract (typed event union) that covers at minimum:
  - version-dispatch fallback decisions (accepted retry and terminal reject),
  - wrapper opaque-tail preservation decisions,
  - parser non-shortage error/reset recovery emission context.
- Structured diagnostics hook(s) at parser/dispatch boundaries that can be
  adapted to existing callbacks without changing default parse semantics.
- Backward-compatible adapter path from existing `onAttachmentVersionFallback`
  to new diagnostics hook contract.
- Remove default `console.warn` fallback path from policy implementations in
  favor of explicit observer wiring.
- Focused tests that lock diagnostics emission shape/count/order in strict and
  compat modes.
- Keep strict/compat as the baseline recovery modes; any new permissive mode
  remains deferred until interop evidence requires it.

Why:

- operationally safer and easier to justify in ecosystem integration

### 7) Separate syntax parsing from semantic interpretation

Status:

- Completed on 2026-03-01.
- Completion evidence:
  - `packages/cesr/src/core/parser-frame-parser.ts`
    - `parseFrame()` now executes as `parseFrameStartSyntax(...)` +
      `interpretFrameStartSyntax(...)`.
    - Native-body parsing now executes as `parseNativeBodySyntax(...)` +
      metadata/field interpretation helpers.
    - Explicit non-goal statement added in code comments: no broad global
      two-pass parser rewrite in this phase.
  - `packages/cesr/src/primitives/mapper.ts`
    - Added explicit syntax artifact path (`parseMapperBodySyntax`) and semantic
      interpretation path (`interpretMapperBodySyntax`), with compatibility
      wrapper retained in `parseMapperBody`.
  - `packages/cesr/src/core/errors.ts`
    - Added `SyntaxParseError` and `SemanticInterpretationError` for
      boundary-classified failures.
  - Tests:
    - `packages/cesr/test/unit/primitives-native.test.ts` (syntax artifact +
      classified error tests)
    - `packages/cesr/test/unit/parser-wrapper-map-errors.test.ts` (parser-level
      classification assertions)
    - Full suite verification: `deno task test` (`135 passed, 0 failed`).

Split token-level extraction from semantic interpretation
(ilk/said/labels/native metadata).

Deliverables:

- extract targeted syntax-artifact types for highest-coupling paths (frame
  start + native body field/value tokenization)
- keep semantic derivation as a second step in those paths without forcing a
  global parser architecture rewrite
- clearer error classes for syntax failures vs semantic interpretation failures
  where separation lands
- explicit non-goal statement in code/docs for unchanged paths to avoid implied
  broad refactor scope

Why:

- cleaner reasoning and simpler debugging
- avoids hidden coupling between tokenization and semantic guesses

### 8) Add parity-oriented behavioral lock tests against `keripy`

Status:

- Completed on 2026-03-02.
- Completed:
  - P0/P1 vectors and split-determinism coverage are implemented and passing.
  - Phase 5 codex/minor-version parity invariants and subset-alignment tests are
    implemented and passing.
  - Initial P2 KERIpy evidence-pack vectors are now lock-tested in
    `packages/cesr/test/hardening/parser-keripy-golden-corpus.test.ts`:
    - `V-P2-017` golden corpus txt/qb2 parity + split determinism
    - `V-P2-018` selected KERIpy codex/subset drift sentinel
    - `V-P2-019` historical implicit-v1 compatibility stream sample
  - Remaining medium/low hardening vectors are now lock-tested in:
    - `packages/cesr/test/hardening/parser-wrapper-breadth.test.ts`: `V-P2-003`,
      `V-P2-004`
    - `packages/cesr/test/hardening/parser-native-body-breadth.test.ts`:
      `V-P2-006`, `V-P2-007`
    - `packages/cesr/test/hardening/parser-version-recovery-fuzz-hardening.test.ts`:
      `V-P2-009`, `V-P2-010`, `V-P2-013`, `V-P2-016`, `V-P2-020`, `V-P2-021`
  - Full CESR suite baseline after Point 8 closure:
    - `deno task test` in `packages/cesr` => `158 passed, 0 failed`

Add vectors and property-like split tests that validate behavior in areas where
parser logic is subtle.

Target remaining cases:

- genus-version counters and version stack behavior
- BodyWithAttachmentGroup nesting
- generic group nesting and re-entry
- mixed-version wrapper payloads
- attachment continuation across chunk boundaries
- legacy implicit-v1 streams (without context/version selector counters)
- binary Serder cold-start parity (JSON/CBOR/MGPK)

Deliverables:

- fixture set and expected outputs documented
- tests grouped by behavior contract, not just method under test

Why:

- provides maintainers high confidence that readability refactors preserve
  semantics

Progress note:

- P0/P1 parity vectors are implemented and tracked in:
  - `docs/archived-plan-docs/cesr/cesr-parser/cesr-parser-phase0-behavior-lock-parity-matrix.md`
- Phase 5 invariants are implemented in:
  - `packages/cesr/test/unit/counter-version-registry.test.ts`
  - `packages/cesr/test/unit/dispatch-spec-invariants.test.ts`
- Initial P2 KERIpy evidence-pack vectors are implemented in:
  - `packages/cesr/test/hardening/parser-keripy-golden-corpus.test.ts`
  - with fixture updates in:
    - `packages/cesr/test/fixtures/external-vectors.ts`
- Deferred breadth hardening is tracked in:
  - `docs/archived-plan-docs/cesr/cesr-parser/cesr-parser-p2-hardening-interop-plan.md`

### 9) Apply naming and terminology normalization pass

Status:

- Completed on 2026-03-01 (documentation-first, targeted scope).
- Completion evidence:
  - parser terminology glossaries added/aligned in:
    - `docs/design-docs/cesr/CESR_PARSER_MAINTAINER_GUIDE.md`
    - `docs/design-docs/cesr/CESR_PARSER_STATE_MACHINE_CONTRACT.md`
  - targeted ambiguity-reducing identifier/comment normalization in:
    - `packages/cesr/src/annotate/annotator.ts`
    - `packages/cesr/src/core/parser-attachment-collector.ts`
    - `packages/cesr/src/core/types.ts`
- Calibration retained:
  - readability gains from Points 1-7 + Phase 5 made broad rename churn
    unnecessary.
  - this pass intentionally stayed narrow and glossary-led unless ambiguity
    materially affected maintenance/review.

Standardize terms used in code and docs:

- frame vs message
- body-group vs attachment-group
- annotation byte handling
- pending/incomplete frame lifecycle

Deliverables:

- terminology glossary in parser docs
- renamed identifiers where ambiguity materially impacts review/comprehension
- avoid large rename-only diffs; fold naming cleanups into behavior-bearing PRs
  when practical

Why:

- naming clarity lowers future cognitive load more than micro-optimizations

### 10) Gate performance optimization behind readability-first abstractions

Status:

- Completed on 2026-03-01.
- Completion evidence:
  - Standard CESR parser baseline benchmarks are now runnable in-repo via
    `deno task bench:cesr` (`packages/cesr/bench/parser.bench.ts`).
  - Reusable readability-first benchmark abstraction is available at
    `packages/cesr/src/bench/parser-benchmark.ts`.
  - Arbitrary-stream benchmark execution is now available through:
    - `deno task bench:cesr:parser --in <path>`
    - `tufa benchmark cesr --in <path>` (or stdin).
  - Deferred perf plan now has explicit benchmark commands and rollback gating
    criteria.

Apply buffer optimizations only after state contracts and decomposition are
complete.

Deliverables:

- use and extend deferred perf plan:
  - `docs/archived-plan-docs/cesr/cesr-parser/cesr-parser-buffer-perf-plan.md`
- ensure optimized internals remain hidden behind readable abstractions
- add/refresh microbenchmark baselines before introducing optimization deltas
- include rollback criteria when complexity increase is not justified by
  measured gains

Why:

- avoids introducing low-level complexity before behavior is fully legible and
  verified

## Non-Goals

- no immediate change to public parser behavior in this plan itself
- no mandatory replacement of compatibility recovery behavior; only explicitness
  and policy control
- no optimization work that reduces readability without benchmark evidence

## Acceptance Criteria

- parser behavior is preserved or changes are explicitly documented and tested
- code paths for frame boundaries and fallback behavior are explainable from
  docs without deep source reading
- dispatch and payload representations are progressively typed and reviewable
  with explicit migration checkpoints
- maintainers can map each behavior to tests and policy choices

## Related Docs

- `docs/adr/adr-0001-parser-atomic-bounded-first.md`
- `docs/design-docs/cesr/CESR_PARSER_STATE_MACHINE_CONTRACT.md`
- `docs/archived-plan-docs/cesr/cesr-parser/cesr-parser-buffer-perf-plan.md`
- `docs/archived-plan-docs/cesr/cesr-parser/cesr-parser-phase0-behavior-lock-parity-matrix.md`
- `docs/archived-plan-docs/cesr/cesr-parser/cesr-parser-p2-hardening-interop-plan.md`
- `packages/cesr/test/unit/parser.test.ts`
