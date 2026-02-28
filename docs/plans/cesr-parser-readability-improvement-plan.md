# CESR Parser Readability Improvement Plan

## Status

- Created: 2026-02-27
- Updated: 2026-02-28
- Priority: high
- Ten-point progress:
  - Completed: Point 1 (`Publish an explicit parser state machine contract`)
  - Completed: Point 2 (`Decompose CesrParser into focused collaborators`)
  - Next: Point 3 (`Replace boolean policy branching with strategy interfaces`)
- Scope:
  - `packages/cesr/src/core/parser-engine.ts`
  - `packages/cesr/src/parser/group-dispatch.ts`
  - `packages/cesr/src/parser/attachment-parser.ts`
  - `packages/cesr/src/primitives/mapper.ts`
  - parser types, errors, and tests in `packages/cesr`

## Purpose

This plan defines ten concrete parser-readability improvements for `keri-ts` CESR parsing, with emphasis on:

- human comprehensibility for maintainers
- defensible design decisions aligned with SOLID and clean-code principles
- preserving real-world CESR compatibility behavior while making that behavior explicit

The plan is informed by comparison against `keripy` main (`keripy/src/keri/core/parsing.py`), while keeping the `keri-ts` architectural advantage of parse-only responsibilities and no direct event-processing side effects.

## Current Baseline (Implemented Since Plan Creation)

The parser now includes several concrete behaviors that should be treated as baseline constraints for readability refactors:

- Point 1 deliverables are complete as of 2026-02-28:
  - canonical lifecycle contract (`docs/design-docs/CESR_PARSER_STATE_MACHINE_CONTRACT.md`)
  - parser lifecycle comments and transition invariants
  - explicit ordering and flush behavior lock tests (including `V-P1-014`)
- Explicit two-track frame lifecycle:
  - `pendingFrame` for in-progress top-level frame continuation across chunk boundaries.
  - `queuedFrames` for additional complete enclosed frames extracted from one `GenericGroup` payload.
- Bounded enclosed parsing:
  - `parseFrameSequence()` parses all enclosed frames inside one size-bounded `GenericGroup` payload slice.
  - `parseGenericGroup()` emits first enclosed frame immediately and queues the remainder for deterministic ordered emission.
- Coherent frame contract functions:
  - `parseFrame()` (body-start parse + stream version/context updates),
  - `parseCompleteFrame()` (bounded full frame parse),
  - `resumePendingFrame()` (incremental top-level continuation),
  - `parseFrameSequence()` (bounded enclosed multi-frame sequence parse).
- Version/context behavior:
  - leading genus-version selectors supported at top-level and inside wrappers,
  - legacy implicit-v1 stream handling is lock-tested.
- Recovery and boundary behavior:
  - strict/compat attachment dispatch mode with fallback callback,
  - `flush()` terminal-shortage idempotency,
  - reset-and-recover behavior lock tests.
- Binary message support:
  - cold-start Serder decode parity support for JSON/CBOR/MGPK bodies (library-backed decoding).

These are now part of the intended parser behavior and must remain readable and explainable through documentation and tests.

## Design Principles

- Single Responsibility: parsing, boundary policy, version fallback, and semantic interpretation should not be interleaved.
- Open/Closed: new CESR codes and parser policies should be addable without rewriting core control flow.
- Liskov/Interface Segregation: smaller parser interfaces should isolate behavior (body parse vs attachment parse vs boundary policy).
- Dependency Inversion: policy choices should be injected, not hard-coded in control branches.
- Clean Code: explicit invariants, minimal hidden state, predictable naming, and typed domain models.

## Ten-Point Plan

### 1) Publish an explicit parser state machine contract

Status:

- Completed on 2026-02-28.
- Completion evidence:
  - `docs/design-docs/CESR_PARSER_STATE_MACHINE_CONTRACT.md`
  - `packages/cesr/test/unit/parser-flush.test.ts` (`V-P1-014`, `V-P1-012`, `V-P0-008`, `V-P0-009`)
  - parser lifecycle comment/invariant updates in `packages/cesr/src/core/parser-engine.ts`

Document and codify parser states, transitions, and emission rules currently spread across:

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
  - `packages/cesr/src/core/parser-engine.ts` reduced to orchestration-focused control flow.
  - Full suite verification in `packages/cesr`: `deno task test` (`118 passed, 0 failed`).

Refactor `CesrParser` orchestration to delegate responsibilities to small units:

- stream/cursor state management
- frame start parsing (message, native, wrapped body groups)
- attachment continuation/collection
- version context management
- enclosed-frame queue and emission policy (`GenericGroup` first-vs-rest behavior)

Deliverables:

- reduced method size and branch fan-out in `parser-engine.ts`
- collaborator interfaces with tight responsibilities
- dedicated helper or collaborator for queued enclosed-frame lifecycle (to avoid drift between pending and queued semantics)

Why:

- keeps the top-level parser readable as control logic rather than implementation details

### 3) Replace boolean policy branching with strategy interfaces

Status:

- Next active point.
- Scope calibrated after Point 2 decomposition:
  inject policies at collaborator boundaries (`parser-engine`, `attachment-collector`, and dispatch entrypoints) instead of broad parser-core rewrites.

Current behavior gates (`framed`, compat/strict fallback handling) should become injected policy objects:

- `FrameBoundaryPolicy`
- `AttachmentVersionFallbackPolicy`

Deliverables:

- elimination of policy condition scattering
- one policy implementation for current behavior; additional policies addable without parser core edits

Why:

- makes behavior choices explicit and testable in isolation

### 4) Replace `unknown[]` attachment payloads with discriminated types

Status:

- In progress (partial).
- Progress to date:
  - internal dispatch payload typing has been narrowed in `group-dispatch.ts` (`GroupItem` model).
- Remaining:
  - public `AttachmentGroup.items` still exposes `unknown[]` and needs a compatibility-aware migration to discriminated unions.

`AttachmentGroup.items: unknown[]` should become typed structures keyed by attachment kind/code.

Deliverables:

- discriminated union for parsed attachment payloads
- explicit shape for tuple/repeated/wrapper groups
- compatibility-preserving raw-bytes access remains available

Why:

- readers and downstream users can understand payload meaning from types, not source spelunking

### 5) Convert dispatch definitions to a single declarative spec

Status:

- Pending (still high-value after Point 2).
- Calibration:
  current v1/v2 maps remain explicit and readable, but descriptor-driven construction is still the best path to reduce repetition/drift.

Keep table-driven dispatch, but define groups from one source of truth (descriptor table), then derive maps.

Deliverables:

- descriptor schema for group code, version, parser kind, and semantic shape
- generated or mechanically built dispatch maps from descriptors

Why:

- minimizes repetition and drift risk in large manual maps
- eases code review for new CESR code additions

### 6) Make recovery behavior explicit, configurable, and observable

Status:

- Pending.
- Calibration:
  existing compat fallback behavior is retained, but diagnostics flow still includes default console warning behavior and should move behind explicit policy/hook wiring.

Current fallback/recovery behavior (mixed-version compat, opaque wrapper tails) should be governed by explicit policy and emitted as structured diagnostics.

Deliverables:

- `RecoveryPolicy` modes (strict/compat/permissive)
- structured hooks/telemetry events for fallback and opaque recovery
- no direct `console.warn` in parser core

Why:

- operationally safer and easier to justify in ecosystem integration

### 7) Separate syntax parsing from semantic interpretation

Status:

- Pending (later-phase refinement).
- Calibration:
  Point 2 established useful boundaries, but syntax-vs-semantic responsibilities are still partially interleaved inside frame/group parsing paths.

Split token-level extraction from semantic interpretation (ilk/said/labels/native metadata).

Deliverables:

- syntax pass produces typed parse artifacts
- semantic pass derives metadata from artifacts
- clearer error classes for syntax failures vs semantic interpretation failures

Why:

- cleaner reasoning and simpler debugging
- avoids hidden coupling between tokenization and semantic guesses

### 8) Add parity-oriented behavioral lock tests against `keripy`

Status:

- Partially complete.
- Completed:
  - P0/P1 vectors and split-determinism coverage are implemented and passing.
- Remaining:
  - P2 breadth/hardening vectors and broader interop fixture expansion.

Add vectors and property-like split tests that validate behavior in areas where parser logic is subtle.

Target cases:

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

- provides maintainers high confidence that readability refactors preserve semantics

Progress note:

- P0/P1 parity vectors are implemented and tracked in:
  - `docs/plans/cesr-parser-phase0-behavior-lock-parity-matrix.md`
- Deferred breadth hardening is tracked in:
  - `docs/plans/cesr-parser-p2-hardening-interop-plan.md`

### 9) Apply naming and terminology normalization pass

Status:

- Pending (narrowed scope).
- Calibration:
  focus on targeted terminology cleanup and glossary-level alignment; avoid broad churn unless ambiguity materially affects maintenance/review.

Standardize terms used in code and docs:

- frame vs message
- body-group vs attachment-group
- annotation byte handling
- pending/incomplete frame lifecycle

Deliverables:

- terminology glossary in parser docs
- renamed identifiers where ambiguity exists

Why:

- naming clarity lowers future cognitive load more than micro-optimizations

### 10) Gate performance optimization behind readability-first abstractions

Status:

- Pending (deferred by design).
- Calibration:
  no change in priority; proceed only after readability/policy/type-model phases and with benchmark evidence.

Apply buffer optimizations only after state contracts and decomposition are complete.

Deliverables:

- use and extend deferred perf plan:
  - `docs/plans/cesr-parser-buffer-perf-plan.md`
- ensure optimized internals remain hidden behind readable abstractions

Why:

- avoids introducing low-level complexity before behavior is fully legible and verified

## Non-Goals

- no immediate change to public parser behavior in this plan itself
- no mandatory replacement of compatibility recovery behavior; only explicitness and policy control
- no optimization work that reduces readability without benchmark evidence

## Acceptance Criteria

- parser behavior is preserved or changes are explicitly documented and tested
- code paths for frame boundaries and fallback behavior are explainable from docs without deep source reading
- dispatch and payload representations are progressively typed and reviewable with explicit migration checkpoints
- maintainers can map each behavior to tests and policy choices

## Related Docs

- `docs/adr/adr-0001-parser-atomic-bounded-first.md`
- `docs/design-docs/CESR_PARSER_STATE_MACHINE_CONTRACT.md`
- `docs/plans/cesr-parser-buffer-perf-plan.md`
- `docs/plans/cesr-parser-phase0-behavior-lock-parity-matrix.md`
- `docs/plans/cesr-parser-p2-hardening-interop-plan.md`
- `packages/cesr/test/unit/parser.test.ts`
