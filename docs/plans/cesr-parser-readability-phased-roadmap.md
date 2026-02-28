# CESR Parser Readability Phased Roadmap

## Status

- Created: 2026-02-27
- Updated: 2026-02-28
- Priority: high
- Depends on: `docs/plans/cesr-parser-readability-improvement-plan.md`
- Related: `docs/plans/cesr-parser-buffer-perf-plan.md` (deferred perf work)

## Objective

Execute parser readability improvements in small, defensible phases so each change set is:

- reviewable by `keri-ts` and `keripy` maintainers
- easy to explain and justify
- behavior-safe by default

This roadmap references and sequences the ten-point plan. Point numbers below map directly to that plan.

## Implementation Snapshot (As Of 2026-02-28)

Completed baseline work that this roadmap now builds on:

- Phase 0 parity lock vectors (P0 and P1) implemented and passing.
- Parser lifecycle docs/comments improved for:
  - `parseFrame()`
  - `parseCompleteFrame()`
  - `resumePendingFrame()`
  - `parseFrameSequence()`
- GenericGroup enclosed-frame queue semantics implemented (`queuedFrames`).
- Version/context selector parity vectors implemented for top-level and nested wrappers.
- Legacy implicit-v1 behavior and binary Serder cold-start vectors implemented.
- P2 breadth/hardening backlog split to a dedicated plan:
  - `docs/plans/cesr-parser-p2-hardening-interop-plan.md`
- Atomic bounded-substream parser decision captured in ADR:
  - `docs/adr/adr-0001-parser-atomic-bounded-first.md`
- Canonical parser lifecycle contract now defined in:
  - `docs/design-docs/CESR_PARSER_STATE_MACHINE_CONTRACT.md`

## Phase Structure

### Phase 0: Baseline and Evidence Capture

Points covered:

- 8 (test lock foundation)
- supporting prep for all points

Status:

- Completed

Scope:

- inventory current parser behavior contracts in tests
- add missing vectors for chunk boundaries, mixed-version fallback, wrapper recovery, and nested groups
- capture baseline parser outputs for known fixtures

Deliverables:

- parity-oriented test matrix
- documented current behavior assumptions and edge cases
- matrix document:
  - `docs/plans/cesr-parser-phase0-behavior-lock-parity-matrix.md`
  - plus deferred breadth backlog:
    - `docs/plans/cesr-parser-p2-hardening-interop-plan.md`

Exit criteria:

- baseline test suite passes
- behaviors affected by future phases are explicitly represented in tests

### Phase 1: State Clarity and Documentation (No behavior changes)

Points covered:

- 1 (state machine contract)
- 9 (naming/terminology normalization, docs-first subset)

Status:

- In progress (core lifecycle docs landed; formal state table/glossary still pending)

Scope:

- document parser state transitions and invariants
- remove TODO ambiguity by turning implicit behavior into explicit documented rules
- align names/comments for frame and continuation lifecycle
- explicitly document `pendingFrame` vs `queuedFrames` responsibilities and emission order

Deliverables:

- parser state contract doc (transition table + invariants)
- updated inline docs in parser entry methods
- terminology glossary for parser docs

Exit criteria:

- no functional deltas in output
- state transitions can be explained from docs without tracing all source branches
- `queuedFrames` and bounded GenericGroup substream behavior are documented as first-class lifecycle rules

### Phase 2: Structural Decomposition (No externally visible behavior changes)

Points covered:

- 2 (collaborator decomposition)
- partial 7 (syntax/semantic separation boundaries)

Scope:

- split `CesrParser` into orchestration + focused collaborators
- isolate cursor/state handling from parsing decisions
- isolate frame-start and attachment-collection logic
- isolate enclosed-frame sequence/queue lifecycle from top-level pending-frame continuation

Deliverables:

- reduced `parser-engine.ts` complexity and method size
- new focused modules with targeted unit tests
- explicit collaborator boundary between:
  - incremental top-level continuation (`pendingFrame`)
  - bounded enclosed sequence parsing and queueing (`queuedFrames`)

Exit criteria:

- all baseline tests pass unchanged
- orchestration layer reads as high-level control flow

### Phase 3: Policy Extraction and Recovery Semantics

Points covered:

- 3 (strategy interfaces)
- 6 (explicit/configurable recovery)

Scope:

- replace boolean behavior branching with injected policies
- convert fallback/recovery behaviors into structured policy outcomes
- remove parser-core side effects like direct warnings

Deliverables:

- policy interfaces and default implementations
- structured fallback/recovery events and diagnostics hooks

Exit criteria:

- strict/compat behavior is policy-driven and testable in isolation
- no behavior regressions in default policy mode

### Phase 4: Typed Payload Model and Dispatch Specification

Points covered:

- 4 (typed attachment payloads)
- 5 (declarative dispatch spec)
- remaining 7 (syntax vs semantic interpretation separation)

Scope:

- replace `unknown[]` payload items with discriminated unions
- define a single descriptor source for attachment dispatch
- finalize syntax artifact vs semantic interpretation layering

Deliverables:

- typed attachment group model
- descriptor-driven dispatch construction
- migration notes for any public type changes

Exit criteria:

- payload structures are self-describing via type system
- adding a new group code requires descriptor updates, not parser branch rewrites

### Phase 5: Hardening, Maintainer Review Pack, and Deferred Perf Hand-off

Points covered:

- 8 (final parity confidence)
- 10 (handoff to deferred perf plan)

Scope:

- produce maintainer-facing rationale and change summary by phase
- include behavior matrix (before/after) and policy compatibility notes
- confirm readiness for perf follow-up behind stable abstractions
- execute and report high-priority P2 hardening vectors before broad ecosystem rollout

Deliverables:

- review packet for maintainers (design rationale + behavior evidence)
- explicit bridge to deferred perf plan
- P2 hardening evidence summary keyed to:
  - `docs/plans/cesr-parser-p2-hardening-interop-plan.md`

Exit criteria:

- maintainers can evaluate changes from documented contracts and tests
- parser internals are ready for cursor-based optimization work without readability regressions

## Risk Management

- Primary risk: hidden behavior changes in nuanced stream boundary scenarios.
  - Mitigation: Phase 0 lock tests + phase-gated exits.
- Primary risk: type model churn affecting downstream users.
  - Mitigation: staged type migration with compatibility notes in Phase 4.
- Primary risk: policy abstraction introducing accidental defaults drift.
  - Mitigation: default-policy golden tests and strict/compat conformance tests.

## PR Sizing Guidance

- Target one PR per phase, except:
  - Phase 0 may be split into two PRs if fixture creation is large.
  - Phase 4 may be split into type-model PR then dispatch-spec PR if review load is high.

Keep each PR focused on one concern class:

- docs/contracts
- structure
- policy
- typing/dispatch
- hardening/evidence

## Suggested Execution Order

1. Phase 0
2. Phase 1
3. Phase 2
4. Phase 3
5. Phase 4
6. Phase 5

No phase should start before the previous phase exit criteria are met.
