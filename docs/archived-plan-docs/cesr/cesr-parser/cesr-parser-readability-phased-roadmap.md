# CESR Parser Readability Phased Roadmap

## Status

- Created: 2026-02-27
- Updated: 2026-03-01
- Priority: high
- Depends on: `docs/archived-plan-docs/cesr/cesr-parser/cesr-parser-readability-improvement-plan.md`
- Related: `docs/archived-plan-docs/cesr/cesr-parser/cesr-parser-buffer-perf-plan.md` (deferred perf
  work)

## Objective

Execute parser readability improvements in small, defensible phases so each
change set is:

- reviewable by `keri-ts` and `keripy` maintainers
- easy to explain and justify
- behavior-safe by default

This roadmap references and sequences the ten-point plan. Point numbers below
map directly to that plan except Phase 5, which is an explicit gap-closure phase
discovered during implementation review.

## Implementation Snapshot (As Of 2026-03-01)

Completed baseline work that this roadmap now builds on:

- Phase 0 parity lock vectors (P0 and P1) implemented and passing.
- Parser lifecycle docs/comments improved for:
  - `parseFrame()`
  - `parseCompleteFrame()`
  - `resumePendingFrame()`
  - `parseFrameSequence()`
- GenericGroup enclosed-frame queue semantics implemented (`queuedFrames`).
- Version/context selector parity vectors implemented for top-level and nested
  wrappers.
- Legacy implicit-v1 behavior and binary Serder cold-start vectors implemented.
- P2 breadth/hardening backlog split to a dedicated plan:
  - `docs/archived-plan-docs/cesr/cesr-parser/cesr-parser-p2-hardening-interop-plan.md`
- Atomic bounded-substream parser decision captured in ADR:
  - `docs/adr/adr-0001-parser-atomic-bounded-first.md`
- Canonical parser lifecycle contract now defined in:
  - `docs/design-docs/cesr/CESR_PARSER_STATE_MACHINE_CONTRACT.md`
- Point 3 policy extraction landed:
  - `FrameBoundaryPolicy` and `AttachmentVersionFallbackPolicy` strategies are
    injected at parser/deferred-dispatch boundaries.
  - Legacy options still map to default strict/compat and framed/unframed policy
    implementations.
- Point 4 typed payload migration landed:
  - `AttachmentGroup.items` now uses discriminated `AttachmentItem` unions.
  - Wrapper-tail recovery items are explicitly tagged as opaque.
- Point 5 declarative dispatch spec landed:
  - `group-dispatch.ts` now defines one descriptor source for dispatch metadata.
  - v1/v2 dispatch maps and related wrapper/siger sets are mechanically derived
    from descriptors.
- Point 7 targeted syntax/semantic separation landed:
  - frame-start parsing now separates token syntax extraction from semantic
    dispatch interpretation,
  - native body parsing now separates syntax artifact extraction from
    metadata/field interpretation,
  - mapper parsing now exposes syntax (`parseMapperBodySyntax`) and semantic
    (`interpretMapperBodySyntax`) phases.
- Point 6 recovery observability landed:
  - parser and dispatch now emit typed `RecoveryDiagnostic` events for fallback
    accepted/rejected, wrapper opaque-tail preservation, and parser error-reset
    context,
  - legacy fallback callback remains adapter-compatible,
  - default compat warning side effects were removed.
- Point 9 naming/terminology normalization landed (targeted scope):
  - parser docs now include explicit glossary entries for frame/message,
    body-group/attachment-group, `ano`, and deferred-frame lifecycle terms,
  - targeted identifier/comment cleanup reduced frame/message ambiguity without
    broad rename churn.
- Phase 5 minor-version model + codex subset parity landed:
  - version-aware `(major, minor)` codex/table registries and resolver semantics
    are now explicit,
  - `CtrDexByVersion` / `UniDexByVersion` / `SUDexByVersion` / `MUDexByVersion`
    are exported,
  - counter-table and dispatch lookups now resolve via versioned registries
    instead of `major >= 2` branching.

## Phase Structure

### Phase 0: Baseline and Evidence Capture

Points covered:

- 8 (test lock foundation)
- supporting prep for all points

Status:

- Completed

Scope:

- inventory current parser behavior contracts in tests
- add missing vectors for chunk boundaries, mixed-version fallback, wrapper
  recovery, and nested groups
- capture baseline parser outputs for known fixtures

Deliverables:

- parity-oriented test matrix
- documented current behavior assumptions and edge cases
- matrix document:
  - `docs/archived-plan-docs/cesr/cesr-parser/cesr-parser-phase0-behavior-lock-parity-matrix.md`
  - plus deferred breadth backlog:
    - `docs/archived-plan-docs/cesr/cesr-parser/cesr-parser-p2-hardening-interop-plan.md`

Exit criteria:

- baseline test suite passes
- behaviors affected by future phases are explicitly represented in tests

### Phase 1: State Clarity and Documentation (No behavior changes)

Points covered:

- 1 (state machine contract)
- 9 (naming/terminology normalization, docs-first subset)

Status:

- Completed on 2026-03-01 (state table + glossary + targeted terminology
  alignment)

Scope:

- document parser state transitions and invariants
- remove TODO ambiguity by turning implicit behavior into explicit documented
  rules
- align names/comments for frame and continuation lifecycle
- explicitly document `pendingFrame` vs `queuedFrames` responsibilities and
  emission order

Deliverables:

- parser state contract doc (transition table + invariants)
- updated inline docs in parser entry methods
- terminology glossary for parser docs

Exit criteria:

- no functional deltas in output
- state transitions can be explained from docs without tracing all source
  branches
- `queuedFrames` and bounded GenericGroup substream behavior are documented as
  first-class lifecycle rules

### Phase 2: Structural Decomposition (No externally visible behavior changes)

Points covered:

- 2 (collaborator decomposition)
- partial 7 (syntax/semantic separation boundaries)

Scope:

- split `CesrParser` into orchestration + focused collaborators
- isolate cursor/state handling from parsing decisions
- isolate frame-start and attachment-collection logic
- isolate enclosed-frame sequence/queue lifecycle from top-level pending-frame
  continuation

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

Status:

- Completed on 2026-03-01 (Point 3 policy extraction + Point 6 recovery
  observability).

Scope:

- completed: replace boolean behavior branching with injected policies
- completed: convert existing fallback/recovery decisions into structured
  diagnostics outcomes
- completed: remove default warning side effects in fallback policy paths by
  routing through explicit diagnostics observers

Deliverables:

- completed: policy interfaces and default implementations
- completed: structured fallback/recovery events and diagnostics hooks

Exit criteria:

- strict/compat behavior is policy-driven and testable in isolation
- parser recovery observability uses structured diagnostics hooks (not default
  warning side effects)
- no behavior regressions in default policy mode

### Phase 4: Typed Payload Model and Dispatch Specification

Points covered:

- 4 (typed attachment payloads)
- 5 (declarative dispatch spec)
- 7 (syntax vs semantic interpretation separation)

Status:

- Completed on 2026-03-01 (Points 4, 5, and 7 complete).

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
- adding a new group code requires descriptor updates, not parser branch
  rewrites

### Phase 5: Minor-Version Model Rectification and Codex Subset Parity

Points covered:

- Cross-cutting gap closure discovered after Point 5 completion
- Supports Point 8 parity and Point 6 observability work by hardening version
  semantics

Status:

- Completed on 2026-03-01.
- Completion evidence:
  - `packages/cesr/src/tables/counter-version-registry.ts`
  - `packages/cesr/src/primitives/counter.ts` (versioned table lookup resolver
    wiring)
  - `packages/cesr/src/parser/group-dispatch.ts` (versioned dispatch/siger-set
    resolver wiring)
  - `packages/cesr/test/unit/counter-version-registry.test.ts`
  - `packages/cesr/test/unit/dispatch-spec-invariants.test.ts`
    (codex/subset/legacy alias invariants)

Scope:

- add explicit major+minor codex modeling for parser dispatch and codex lookup
- align selection semantics with KERIpy-style minor compatibility progression
  (versioned registries where parser may bind to latest supported compatible
  minor within a major)
- add codex subset concepts in `keri-ts` analogous to KERIpy:
  - `UniDex`-style universal subsets
  - `SUDex`-style special universal subsets
  - `MUDex`-style message universal subsets
- preserve legacy compatibility aliases (including v1 `-J/-K` sad-path entries)
  with explicit allowlists and tests

Deliverables:

- version-aware codex registries keyed by major/minor with explicit resolution
  contract for parser/runtime context
- stable subset alias exports for readability and boundary checks
- invariant tests covering:
  - no duplicate `(major, minor, code)` entries in routing registries
  - full coverage between generated tables and dispatch/codex subset layers
  - explicit compatibility-only aliases as auditable exceptions

Exit criteria:

- parser and dispatch behavior can be reasoned about at major+minor granularity
- subset membership checks are explicit and readable (no ad-hoc code lists)
- KERIpy maintainers can map `CtrDex/UniDex/SUDex/MUDex` concepts directly to
  `keri-ts` equivalents without source spelunking

Proposed TypeScript alias model (illustrative):

```ts
export const CtrDexByVersion = {
  1: { 0: CtrDexV1 },
  2: { 0: CtrDexV2 },
} as const;

export const UniDexByVersion = {
  1: { 0: UniDexV1 },
  2: { 0: UniDexV2 },
} as const;

export const SUDexByVersion = {
  1: { 0: SUDexV1 },
  2: { 0: SUDexV2 },
} as const;

export const MUDexByVersion = {
  1: { 0: MUDexV1 },
  2: { 0: MUDexV2 },
} as const;
```

### Phase 6: Hardening, Maintainer Review Pack, and Deferred Perf Hand-off

Points covered:

- 8 (final parity confidence)
- 10 (handoff to deferred perf plan)

Status:

- In progress on 2026-03-01.
- Point 10 baseline deliverables are complete (standard benchmark flow +
  `tufa benchmark cesr` bridge + deferred perf rollback gating criteria).
- Point 8 breadth hardening vectors remain the outstanding Phase 6 parser
  milestone.

Scope:

- produce maintainer-facing rationale and change summary by phase
- include behavior matrix (before/after) and policy compatibility notes
- confirm readiness for perf follow-up behind stable abstractions
- execute and report high-priority P2 hardening vectors before broad ecosystem
  rollout

Deliverables:

- review packet for maintainers (design rationale + behavior evidence)
- explicit bridge to deferred perf plan
- P2 hardening evidence summary keyed to:
  - `docs/archived-plan-docs/cesr/cesr-parser/cesr-parser-p2-hardening-interop-plan.md`

Exit criteria:

- maintainers can evaluate changes from documented contracts and tests
- parser internals are ready for cursor-based optimization work without
  readability regressions

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
  - Phase 4 may be split into type-model PR then dispatch-spec PR if review load
    is high.
  - Phase 5 may be split into codex/subset model PR then parser-wiring PR if
    review load is high.

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
7. Phase 6

No phase should start before the previous phase exit criteria are met.

## Deferred Low-Priority Backlog

1. **Residual version-context layering hardening (`gvrsn` vs `pvrsn`)**
   - Priority: low (after Phase 5 baseline rectification unless interop evidence
     raises urgency).
   - Context:
     - Current parser frame-attachment context may use `gvrsn ?? pvrsn` as a
       compatibility bridge in legacy/no-selector paths.
     - CESR/KERI abstractions model genus-version and protocol-version as
       distinct fields; using protocol-version as fallback is pragmatic but not
       ideal for strict layering.
     - KERIpy keeps explicit genus-version context in parser state/version-stack
       flows and enforces compatibility checks in Serder reaping paths.
   - Why track:
     - Preserve current interoperability while reducing ambiguity when
       protocol-version and genus-version may diverge.
     - Ensure attachment/code-table dispatch remains grounded in genus-version
       semantics.
   - Proposed follow-up:
     - Introduce explicit genus-version parse context in frame parse results
       (separate from protocol version fields).
     - Restrict `pvrsn` fallback to an explicit legacy policy path, not implicit
       default behavior.
     - Add parity/contract tests for divergence and mismatch scenarios
       (including wrapper-scoped nested version transitions).
     - Decide strict-vs-compat mismatch handling (reject, warn+fallback, or
       policy-controlled) and document contract updates.
