# PROJECT_LEARNINGS_CESR

## Purpose

Persistent CESR parser memory for `keri-ts`.

## Current State

### 2026-03-01

1. **Ten-point plan status**

- Point 1 (`Publish an explicit parser state machine contract`) is complete as
  of 2026-02-28.
- Point 2 (`Decompose CesrParser into focused collaborators`) is complete as of
  2026-02-28.
- Point 3 (`Replace boolean policy branching with strategy interfaces`) is
  complete as of 2026-03-01.
- Point 4 (`Replace unknown[] attachment payloads with discriminated types`) is
  complete as of 2026-03-01.
- Point 5 (`Convert dispatch definitions to a single declarative spec`) is
  complete as of 2026-03-01.
- Point 6 (`Make recovery behavior explicit, configurable, and observable`) is
  complete as of 2026-03-01 with structured recovery diagnostics and removal of
  default warning side effects.
- Point 7 (`Separate syntax parsing from semantic interpretation`) is complete
  as of 2026-03-01 in targeted high-coupling paths.
- Point 9 (`Apply naming and terminology normalization pass`) is complete as of
  2026-03-01 with glossary-first docs alignment and targeted ambiguity-reducing
  cleanup.
- Point 10
  (`Gate performance optimization behind readability-first abstractions`) is
  complete as of 2026-03-01 with baseline benchmark flows and deferred perf
  rollback criteria.

2. **Architecture direction**

- Atomic bounded-substream parser is intentional and documented.
- Incremental nested parser is deferred for a later perf-oriented module.

3. **Normative lifecycle contract**

- `docs/design-docs/CESR_PARSER_STATE_MACHINE_CONTRACT.md` is canonical.
- Contract is test-mapped and governs lifecycle behavior updates.

4. **Frame lifecycle model**

- `pendingFrame`: unresolved top-level frame continuation.
- `queuedFrames`: additional complete enclosed frames from `GenericGroup`.

5. **Ordering contract**

- Stream-order preservation is normative when pending and queued coexist.
- `flush()` now emits pending first, then queued.
- Covered by `V-P1-014`.

6. **GenericGroup behavior**

- Bounded payload parsing via `parseFrameSequence(...)`.
- First enclosed frame returns immediately; remainder queued.

7. **Version context model**

- Top-level stream scope (`streamVersion`).
- Frame attachment scope (`version`).
- Nested wrapper scope in dispatch parsing.
- Legacy implicit-v1 (no selector counters) is lock-tested.

8. **Dispatch behavior**

- `strict`: no major fallback.
- `compat`: fallback on unknown/deserialize errors with structured diagnostics;
  legacy fallback callback is adapter-backed for backward compatibility.
- v1/v2 dispatch maps, wrapper-code sets, and siger-list allowances are
  generated from one declarative descriptor spec.

9. **Flush semantics**

- Terminal remainder shortage emitted once.
- Repeated `flush()` is idempotent.

10. **Binary cold-start support**

- JSON, MGPK, and CBOR Serder cold-start tests pass.
- Uses external libraries for binary handling.

11. **Parity posture**

- P0 and P1 vectors complete and passing.
- P2 breadth/hardening tracked separately.

12. **Attachment payload type model**

- `AttachmentGroup.items` now uses a discriminated `AttachmentItem` union
  (`qb64`, `qb2`, `tuple`, `group`).
- Wrapper opaque-tail fallback units are explicit via `opaque: true` on
  `qb64`/`qb2` items.
- Primitive wrappers (`Sealer`, `Blinder`, `Mediar`, `Aggor` list mode) now
  expose typed items instead of `unknown[]`.

13. **Phase 5 minor-version + codex subset parity**

- `CtrDexByVersion`, `UniDexByVersion`, `SUDexByVersion`, and `MUDexByVersion`
  are now explicit `(major, minor)` registries with resolver semantics aligned
  to KERIpy-style latest-compatible-minor binding.
- `parseCounter` and attachment dispatch/siger-set lookup now resolve through
  versioned registries instead of `major >= 2` branching.
- Legacy v1 `-J/-K` compatibility aliases are explicitly tracked as allowlisted
  exceptions (not first-class entries in `CtrDexByVersion`), with invariants
  ensuring auditable behavior.

14. **Readability plan tail (Points 6-10) recalibrated**

- Point 6 is complete with one `RecoveryDiagnostic` contract
  (`version-fallback-accepted`, `version-fallback-rejected`,
  `wrapper-opaque-tail-preserved`, `parser-error-reset`) at parser/dispatch
  boundaries.
- Point 7 is complete with targeted syntax-artifact extraction in high-coupling
  paths (frame start + native body + mapper tokenization), without a global
  two-pass rewrite.
- Point 8 is complete: initial KERIpy evidence-pack vectors (`V-P2-017`..`019`)
  plus remaining medium/low breadth vectors (`V-P2-003`, `004`, `006`, `007`,
  `009`, `010`, `013`, `016`, `020`, `021`) are now lock-tested.
- Point 9 is complete in docs-first targeted scope (glossary + selective
  ambiguity cleanup; no broad rename churn).
- Point 10 baseline gating is complete: parser benchmark flows are standardized
  and wired into `tufa`, while optimization implementation remains deferred
  behind benchmark evidence and rollback criteria.

15. **Test fixture organization**

- Common CESR test builders are centralized in descriptive fixture modules:
  - `test/fixtures/stream-byte-fixtures.ts`
  - `test/fixtures/counter-token-fixtures.ts`
  - `test/fixtures/versioned-body-fixtures.ts`
- Unit tests no longer duplicate local `encode`/`counterV*`/`sigerToken`/`v*ify`
  helper definitions.

16. **Point 7 syntax/semantic boundary model**

- `parseFrame()` now runs through explicit syntax artifact extraction then
  semantic frame-kind interpretation.
- Native body parsing now builds syntax artifacts first, then projects
  metadata/fields in dedicated semantic helpers.
- Mapper now exposes first-class syntax (`parseMapperBodySyntax`) and semantic
  (`interpretMapperBodySyntax`) APIs.
- Boundary-specific error classes now distinguish token/syntax failures
  (`SyntaxParseError`) from semantic projection failures
  (`SemanticInterpretationError`).

17. **Point 8 KERIpy parity hardening progress**

- Added a dedicated hardening suite
  `test/hardening/parser-keripy-golden-corpus.test.ts`.
- Vectors `V-P2-017`, `V-P2-018`, and `V-P2-019` are now implemented and
  passing.
- KERIpy-derived v1 JSON ICP fixture material is now pinned in
  `test/fixtures/external-vectors.ts`.

18. **Point 8 high-priority breadth vectors are now complete**

- Added
  `packages/cesr/test/hardening/parser-p2-high-priority-hardening.test.ts`.
- Implemented and passing: `V-P2-001`, `V-P2-002`, `V-P2-005`, `V-P2-008`,
  `V-P2-011`, `V-P2-012`, `V-P2-014`, `V-P2-015`.
- Combined with earlier `V-P2-017`, all current P2 `H` vectors are now
  lock-tested.

19. **Formal reconciliation and completeness decision are published**

- Added evidence artifacts:
  - `docs/design-docs/cesr-parser/CESR_PARSER_RECONCILIATION_MATRIX_2026-03-01.md`
  - `docs/design-docs/cesr-parser/CESR_PARSER_CROSS_IMPL_COMPARISON_2026-03-01.md`
  - `docs/design-docs/cesr-parser/CESR_PARSER_COMPLETENESS_DECISION_2026-03-01.md`
- Current formal decision for parser completeness gate is `GO` (no open `S0/S1`
  vs KERIpy baseline).

20. **Regression baseline updated after reconciliation**

- `deno task test` in `packages/cesr` now reports `158 passed, 0 failed`.
- Pre-hardening baseline captured during reconciliation was
  `140 passed, 0 failed`.

21. **Point 8 closure and P2 breadth completion are now explicit**

- Remaining P2 medium/low vectors are now complete and passing: `V-P2-003`,
  `004`, `006`, `007`, `009`, `010`, `013`, `016`, `020`, `021`.
- Reconciliation rows `REQ-CESR-020`, `REQ-CESR-022`, and `REQ-CESR-024` are now
  `Implemented+Tested`.

22. **Cross-implementation advisory scope expanded**

- Added full advisory reconciliation for `CESRox` and `kerits` to the
  cross-implementation comparison artifact.
- Both are currently assessed as useful interoperability references with
  narrower parser-contract breadth than `KERIpy`, and any divergences remain
  `S3` advisory under the KERIpy-first gate.

23. **CESRide and KERIde alignment context added**

- Added `cesride` to the advisory comparator set with deeper notes on
  primitive-level strength vs stream-parser contract scope limits.
- Added explicit CESRide/KERIde coupling notes: KERIde currently vendors
  CESR/parside code in-tree rather than consuming CESRide as a package
  dependency.
- Added a recommended next-pass granular comparison matrix for future
  CESRide/KERIde upgrade planning.

24. **KERIde added as an explicit comparator implementation**

- Added `keride` to the cross-implementation capability matrix and advisory
  divergences.
- Captured direct dependency and architecture findings:
  - KERIde does not currently depend on external `cesride` in `Cargo.toml`.
  - KERIde exposes `from_stream_bytes` parser entry points but no unified
    `feed()/flush()` parser-engine lifecycle contract.

## Key Docs

1. `docs/design-docs/CESR_PARSER_STATE_MACHINE_CONTRACT.md`
2. `docs/design-docs/CESR_ATOMIC_BOUNDED_PARSER_ARCHITECTURE.md`
3. `docs/plans/cesr/cesr-parser-readability-improvement-plan.md`
4. `docs/plans/cesr/cesr-parser-readability-phased-roadmap.md`
5. `docs/plans/cesr/cesr-parser-phase0-behavior-lock-parity-matrix.md`
6. `docs/plans/cesr/cesr-parser-p2-hardening-interop-plan.md`
7. `docs/adr/adr-0001-parser-atomic-bounded-first.md`

## Current Follow-Ups

1. Keep lifecycle contract matrix synchronized with diagnostics and recovery
   behavior tests.
2. Keep medium/low hardening vectors in CI as locked regression coverage while
   upper-layer implementation work proceeds.
3. Preserve full P2 vector coverage as regression floor (`V-P2-001`..`021`).
4. Monitor downstream migration from legacy `onAttachmentVersionFallback` toward
   `onRecoveryDiagnostic`.

## Handoff Log

### 2026-03-02 - Point 8 Closure and REQ-CESR-020/022/024 Completion

- What changed:
  - Added new hardening suites and shared helpers:
    - `packages/cesr/test/hardening/hardening-helpers.ts`
    - `packages/cesr/test/hardening/parser-wrapper-breadth.test.ts` (`V-P2-003`,
      `V-P2-004`)
    - `packages/cesr/test/hardening/parser-native-body-breadth.test.ts`
      (`V-P2-006`, `V-P2-007`)
    - `packages/cesr/test/hardening/parser-version-recovery-fuzz-hardening.test.ts`
      (`V-P2-009`, `010`, `013`, `016`, `020`, `021`)
  - Updated closure/status docs:
    - `docs/plans/cesr/cesr-parser-p2-hardening-interop-plan.md`
    - `docs/plans/cesr/cesr-parser-readability-improvement-plan.md`
    - `docs/design-docs/cesr-parser/CESR_PARSER_RECONCILIATION_MATRIX_2026-03-01.md`
    - `docs/design-docs/cesr-parser/CESR_PARSER_COMPLETENESS_DECISION_2026-03-01.md`
- Why:
  - Close Point 8 parity breadth, complete all remaining medium/low P2 vectors,
    and resolve reconciliation rows `REQ-CESR-020`, `REQ-CESR-022`, and
    `REQ-CESR-024` to `Implemented+Tested`.
- Tests:
  - Command:
    `deno test test/hardening/parser-wrapper-breadth.test.ts test/hardening/parser-native-body-breadth.test.ts test/hardening/parser-version-recovery-fuzz-hardening.test.ts`
  - Result: `10 passed, 0 failed`
  - Command: `deno task test` (in `packages/cesr`)
  - Result: `158 passed, 0 failed`
- Contracts/plans touched:
  - `docs/plans/cesr/cesr-parser-p2-hardening-interop-plan.md`
  - `docs/plans/cesr/cesr-parser-readability-improvement-plan.md`
  - `docs/design-docs/cesr-parser/CESR_PARSER_RECONCILIATION_MATRIX_2026-03-01.md`
  - `docs/design-docs/cesr-parser/CESR_PARSER_COMPLETENESS_DECISION_2026-03-01.md`
- Risks/TODO:
  - Maintain deterministic split/mutation fuzz seeds to avoid CI flake while
    preserving breadth stress value.

### 2026-03-02 - Design-Doc Reorg Link Synchronization

- What changed:
  - Updated stale CESR design-doc path references in:
  - Updated AGENTS shorthand routing references to fully qualified
    `docs/design-docs/PROJECT_LEARNINGS.md`.

### 2026-03-01 - keride Added to Cross-Impl and Dependency/Engine Check

- What changed:
  - Added `keride` to:
    - `docs/design-docs/cesr-parser/CESR_PARSER_CROSS_IMPL_COMPARISON_2026-03-01.md`
      (baseline list, evidence inputs, capability matrix, implementation notes,
      advisory divergences)
  - Synced comparator summary mentions in:
    - `docs/design-docs/cesr-parser/CESR_PARSER_COMPLETENESS_DECISION_2026-03-01.md`
    - `docs/design-docs/PROJECT_LEARNINGS.md`
- Why:
  - Capture explicit comparator status for KERIde and answer whether it
    currently consumes CESRide and whether it provides a unified stream parser
    engine contract.
- Tests:
  - Command: not run (documentation/evidence reconciliation update)
  - Result: n/a
- Contracts/plans touched:
  - `docs/design-docs/cesr-parser/CESR_PARSER_CROSS_IMPL_COMPARISON_2026-03-01.md`
  - `docs/design-docs/cesr-parser/CESR_PARSER_COMPLETENESS_DECISION_2026-03-01.md`
- Risks/TODO:
  - If the goal is true CESRide reuse in KERIde, plan a packaging/integration
    step to replace vendored CESR/parside modules with explicit dependency
    boundaries and compatibility tests.

### 2026-03-01 - cesride Added to Cross-Impl + CESRide/KERIde Alignment Notes

- What changed:
  - Updated
    `docs/design-docs/cesr-parser/CESR_PARSER_CROSS_IMPL_COMPARISON_2026-03-01.md`
    to add `cesride` as an advisory baseline with capability ratings,
    implementation notes, and advisory divergence items.
  - Added a new section documenting CESRide/KERIde alignment risks and a
    proposed granular follow-on capability matrix.
  - Synced comparator-summary mentions in:
    - `docs/design-docs/cesr-parser/CESR_PARSER_COMPLETENESS_DECISION_2026-03-01.md`
    - `docs/design-docs/PROJECT_LEARNINGS.md`
- Why:
  - Support near-term CESRide/KERIde update planning with explicit evidence of
    current coupling and parser-scope boundaries.
- Tests:
  - Command: not run (documentation/evidence reconciliation update)
  - Result: n/a
- Contracts/plans touched:
  - `docs/design-docs/cesr-parser/CESR_PARSER_CROSS_IMPL_COMPARISON_2026-03-01.md`
  - `docs/design-docs/cesr-parser/CESR_PARSER_COMPLETENESS_DECISION_2026-03-01.md`
- Risks/TODO:
  - Build the proposed granular matrix with executable per-row vectors before
    CESRide/KERIde synchronization work starts.

### 2026-03-01 - Cross-Impl Scope Expansion (CESRox + kerits)

- What changed:
  - Extended cross-implementation reconciliation to include:
    - `cesrox` (`/Users/kbull/code/keri/kentbull/cesrox`)
    - `kerits` (`/Users/kbull/code/keri/kentbull/kerits`)
  - Updated:
    - `docs/design-docs/cesr-parser/CESR_PARSER_CROSS_IMPL_COMPARISON_2026-03-01.md`
    - `docs/design-docs/cesr-parser/CESR_PARSER_COMPLETENESS_DECISION_2026-03-01.md`
- Why:
  - Expand comparator coverage as requested and confirm whether added
    implementation deltas change parser completeness gate status.
- Tests:
  - Command: not run (documentation/evidence reconciliation update)
  - Result: n/a
- Contracts/plans touched:
  - `docs/design-docs/cesr-parser/CESR_PARSER_CROSS_IMPL_COMPARISON_2026-03-01.md`
  - `docs/design-docs/cesr-parser/CESR_PARSER_COMPLETENESS_DECISION_2026-03-01.md`
- Risks/TODO:
  - Continue treating KERIpy as blocking baseline; keep non-KERIpy comparator
    deltas advisory unless they expose KERIpy/spec mismatch.

### 2026-03-01 - CESR Parser Reconciliation, Cross-Impl Comparison, and Completeness Decision

- What changed:
  - Added high-priority P2 hardening suite:
    - `packages/cesr/test/hardening/parser-p2-high-priority-hardening.test.ts`
  - Implemented vectors:
    - `V-P2-001`, `V-P2-002`, `V-P2-005`, `V-P2-008`, `V-P2-011`, `V-P2-012`,
      `V-P2-014`, `V-P2-015`
  - Added dated reconciliation artifacts:
    - `docs/design-docs/cesr-parser/CESR_PARSER_RECONCILIATION_MATRIX_2026-03-01.md`
    - `docs/design-docs/cesr-parser/CESR_PARSER_CROSS_IMPL_COMPARISON_2026-03-01.md`
    - `docs/design-docs/cesr-parser/CESR_PARSER_COMPLETENESS_DECISION_2026-03-01.md`
  - Updated P2 backlog status document:
    - `docs/plans/cesr/cesr-parser-p2-hardening-interop-plan.md`
- Why:
  - Complete the parser-completeness gate using KERIpy-first reconciliation and
    determine if upper-layer LMDB/KEL/witness-watcher work can proceed.
- Tests:
  - Command: `deno task test` (in `packages/cesr`)
  - Result: `148 passed, 0 failed`
- Contracts/plans touched:
  - `docs/plans/cesr/cesr-parser-p2-hardening-interop-plan.md`
  - reconciliation/comparison/decision docs listed above
- Risks/TODO:
  - Remaining P2 medium/low vectors (`V-P2-003`, `004`, `006`, `007`, `009`,
    `010`, `013`, `016`, `020`, `021`) remain as `S2` hardening debt.

### 2026-02-28 - Point 1 State Contract Implementation

- What changed:
  - Added canonical state-machine contract doc.
  - Added parser comments linking to contract.
  - Corrected flush order for pending/queued coexistence.
  - Added `V-P1-014` ordering test.
  - Linked contract across architecture/maintainer/plan docs.
- Why:
  - Make parser lifecycle explicit, normative, and reviewable.
- Tests:
  - Command: `deno task test` (in `packages/cesr`)
  - Result: `118 passed, 0 failed`
- Contracts/plans touched:
  - state machine contract, parity matrix, roadmap/improvement docs,
    architecture guide.
- Risks/TODO:
  - Preserve mapping discipline as decomposition proceeds.

### 2026-02-28 - Point 1 Completion Reflected in Learnings/Plan

- What changed:
  - Explicitly recorded Point 1 completion and Point 2 next-step status in CESR
    learnings current-state section.
  - Synced milestone language with
    `docs/plans/cesr/cesr-parser-readability-improvement-plan.md`.
- Why:
  - Keep thread handoff state unambiguous and aligned across learnings +
    execution plan docs.
- Tests:
  - Command: not run (documentation-only update)
  - Result: n/a
- Contracts/plans touched:
  - `docs/plans/cesr/cesr-parser-readability-improvement-plan.md`
- Risks/TODO:
  - Maintain milestone/status sync as Point 2 decomposition work lands.

### 2026-02-28 - Point 2 CesrParser Collaborator Decomposition

- What changed:
  - Split parser responsibilities into focused collaborators:
    - `packages/cesr/src/core/parser-stream-state.ts` (buffer/cursor + stream
      version state),
    - `packages/cesr/src/core/parser-deferred-frames.ts`
      (`pendingFrame`/`queuedFrames` lifecycle),
    - `packages/cesr/src/core/parser-frame-parser.ts` (frame-start and
      body-group parsing),
    - `packages/cesr/src/core/parser-attachment-collector.ts` (attachment
      continuation/collection),
    - `packages/cesr/src/core/parser-constants.ts` (shared parser
      constants/helpers).
  - Reduced `packages/cesr/src/core/parser-engine.ts` to orchestration control
    flow over collaborators.
  - Preserved lifecycle contract behavior including pending-vs-queued ordering
    and split determinism.
- Why:
  - Complete Point 2 readability milestone by isolating responsibilities and
    reducing branch fan-out in parser orchestration.
- Tests:
  - Command: `deno task test` (in `packages/cesr`)
  - Result: `118 passed, 0 failed`
- Contracts/plans touched:
  - `docs/plans/cesr/cesr-parser-readability-improvement-plan.md`
- Risks/TODO:
  - Point 3 policy extraction should avoid changing default strict/compat
    semantics while introducing strategy interfaces.

### 2026-03-01 - Point 3 Strategy Interface Extraction

- What changed:
  - Added `FrameBoundaryPolicy` strategy interface and default implementations
    in `packages/cesr/src/core/parser-policy.ts`.
  - Refactored `parser-engine`, `parser-frame-parser`, and
    `parser-attachment-collector` to consume injected `FrameBoundaryPolicy`
    instead of branching on `framed`.
  - Added `AttachmentVersionFallbackPolicy` strategy interface with
    strict/compat implementations and factories in
    `packages/cesr/src/parser/group-dispatch.ts`.
  - Refactored attachment dispatch and wrapper recovery paths to delegate
    strict/compat behavior to fallback policy strategies instead of mode
    branching.
  - Preserved API compatibility by mapping legacy options (`framed`,
    `attachmentDispatchMode`, `onAttachmentVersionFallback`) into default
    strategy instances.
- Why:
  - Complete Point 3 by removing scattered policy conditionals and making parser
    behavior choices explicit, injectable, and testable.
- Tests:
  - Command: `deno task test` (in `packages/cesr`)
  - Result: `118 passed, 0 failed`
- Contracts/plans touched:
  - `docs/plans/cesr/cesr-parser-readability-improvement-plan.md`
  - `docs/plans/cesr/cesr-parser-readability-phased-roadmap.md`
- Risks/TODO:
  - Point 4 still needs compatibility-aware migration from
    `AttachmentGroup.items: unknown[]` to discriminated payload types.

### 2026-03-01 - Policy Module Extraction Follow-Up

- What changed:
  - Moved attachment fallback policy strategy types/implementations from
    `packages/cesr/src/parser/group-dispatch.ts` into dedicated module
    `packages/cesr/src/parser/attachment-fallback-policy.ts`.
  - Kept `group-dispatch.ts` API compatibility by re-exporting fallback policy
    types/factories from the new module and preserving strict/compat behavior
    wiring.
- Why:
  - Reduce `group-dispatch.ts` length and keep policy concerns isolated from
    dispatch-table mechanics.
- Tests:
  - Command: `deno task test` (in `packages/cesr`)
  - Result: `118 passed, 0 failed`
- Contracts/plans touched:
  - `docs/plans/cesr/cesr-parser-readability-improvement-plan.md`
- Risks/TODO:
  - Continue keeping strategy modules focused as Point 4 typed payload refactors
    land.

### 2026-03-01 - Fallback Factory Surface Simplification

- What changed:
  - Removed unused convenience wrappers
    `createStrictAttachmentVersionFallbackPolicy` and
    `createCompatAttachmentVersionFallbackPolicy` from
    `packages/cesr/src/parser/attachment-fallback-policy.ts`.
  - Kept `createAttachmentVersionFallbackPolicy({ mode, onVersionFallback })` as
    the single public fallback policy factory path.
  - Preserved strict parsing entrypoint behavior in `group-dispatch.ts` by
    constructing strict policy via
    `createAttachmentVersionFallbackPolicy({ mode: "strict" })`.
- Why:
  - Reduce API surface area and avoid parallel factory paths that encode the
    same behavior.
- Tests:
  - Command: `deno task test` (in `packages/cesr`)
  - Result: `118 passed, 0 failed`
- Contracts/plans touched:
  - `docs/plans/cesr/cesr-parser-readability-improvement-plan.md`
- Risks/TODO:
  - If external downstream users rely on removed wrappers, add explicit
    migration notes in the next release notes pass.

### 2026-03-01 - Point 4 Typed Attachment Payload Migration

- What changed:
  - Replaced `AttachmentGroup.items: unknown[]` with a discriminated
    `AttachmentItem` union in `packages/cesr/src/core/types.ts`.
  - Refactored `packages/cesr/src/parser/group-dispatch.ts` to emit tagged
    payload items (`qb64`, `qb2`, `tuple`, `group`) across
    tuple/repeated/wrapper paths.
  - Preserved compatibility behavior for wrapper-tail recovery by tagging
    preserved opaque units with `opaque: true`.
  - Updated consumers (`annotate/render`, `sealer`, `blinder`, `mediar`,
    `aggor`) and focused tests to use discriminants instead of runtime casts.
- Why:
  - Complete Point 4 deliverables so attachment payload semantics are explicit
    in the public type model.
- Tests:
  - Command: `deno task test` (in `packages/cesr`)
  - Result: `118 passed, 0 failed`
- Contracts/plans touched:
  - `docs/plans/cesr/cesr-parser-readability-improvement-plan.md`
  - `docs/plans/cesr/cesr-parser-readability-phased-roadmap.md`
- Risks/TODO:
  - Downstream users that depended on raw `string | Uint8Array | object | array`
    item shapes must migrate to discriminant checks.

### 2026-03-01 - Point 5 Declarative Dispatch Spec Conversion

- What changed:
  - Replaced manual v1/v2 dispatch maps in
    `packages/cesr/src/parser/group-dispatch.ts` with descriptor-driven
    construction from one canonical `ATTACHMENT_DISPATCH_SPEC`.
  - Introduced a typed dispatch descriptor schema capturing version, parser
    kind, and semantic shape metadata, with tuple/wrapper/siger flags.
  - Derived wrapper-group code sets and siger-list allowance sets from
    descriptors to remove separate hand-maintained code lists.
- Why:
  - Complete Point 5 by removing duplicated dispatch wiring and reducing drift
    risk between parser code tables and behavior expectations.
- Tests:
  - Command: `deno task test` (in `packages/cesr`)
  - Result: `118 passed, 0 failed`
- Contracts/plans touched:
  - `docs/plans/cesr/cesr-parser-readability-improvement-plan.md`
  - `docs/plans/cesr/cesr-parser-readability-phased-roadmap.md`
- Risks/TODO:
  - Point 6 still needs structured recovery diagnostics so compat fallbacks stop
    relying on warning-style side effects.

### 2026-03-01 - Dispatch Spec Invariant Lock Test (Generated Tables + Legacy SAD Path Aliases)

- What changed:
  - Added `packages/cesr/test/unit/dispatch-spec-invariants.test.ts` to enforce
    dispatch integrity against generated counter tables.
  - Exported `ATTACHMENT_DISPATCH_SPEC` from
    `packages/cesr/src/parser/group-dispatch.ts` so invariants can assert
    coverage/uniqueness directly from the canonical spec.
  - Added explicit compatibility allowance for legacy v1 `-J/-K` entries so
    these remain required in dispatch routing even if future generated codex
    tables stop listing them.
- Why:
  - Prevent silent dispatch drift (duplicates/omissions) and preserve long-term
    backwards compatibility for deployed sad-path alias streams.
- Tests:
  - Command: `deno task test` (in `packages/cesr`)
  - Result: `119 passed, 0 failed`
- Contracts/plans touched:
  - `docs/plans/cesr/cesr-parser-readability-improvement-plan.md`
- Risks/TODO:
  - If new intentional compatibility-only aliases are added, update invariant
    allowlist explicitly to keep intent auditable.

### 2026-03-01 - Learner/Maintainer-First Design Bias Captured In Startup Instructions

- What changed:
  - Updated `AGENTS.md` with explicit guidance to prioritize learner/maintainer
    comprehension for parser/codex work.
  - Added explicit TypeScript bias toward compile-time typed contracts and
    exhaustive mappings over runtime indirection.
  - Added explicit deterministic-parser guidance for CESR/TLV behavior with
    policy-gated flexibility.
- Why:
  - Keep architecture choices consistent across future agent sessions and reduce
    drift toward dynamic but harder-to-review dispatch patterns.
- Tests:
  - Command: not run (docs-only update)
  - Result: n/a
- Contracts/plans touched:
  - `AGENTS.md`
- Risks/TODO:
  - Revisit wording if future roadmap phases intentionally require more dynamic
    plugin-style dispatch.

### 2026-03-01 - Roadmap Rephase: Minor-Version Modeling + Codex Subset Parity Elevated To Phase 5

- What changed:
  - Updated `docs/plans/cesr/cesr-parser-readability-phased-roadmap.md` to
    insert a new Phase 5 focused on:
    - explicit major/minor codex modeling aligned with KERIpy minor-version
      progression semantics,
    - codex subset concepts (`UniDex`/`SUDex`/`MUDex` analogs),
    - invariant coverage for subset/dispatch integrity and compatibility
      aliases.
  - Renumbered previous hardening/review handoff phase from Phase 5 to Phase 6.
  - Added an illustrative TypeScript subset-alias model sketch to make planned
    naming-indirection formalization concrete.
- Why:
  - Minor-version parity and codex-subset readability are now critical
    interoperability requirements, not deferred backlog.
- Tests:
  - Command: not run (documentation-only update)
  - Result: n/a
- Contracts/plans touched:
  - `docs/plans/cesr/cesr-parser-readability-phased-roadmap.md`
  - `docs/design-docs/PROJECT_LEARNINGS.md`
- Risks/TODO:
  - Improvement plan
    (`docs/plans/cesr/cesr-parser-readability-improvement-plan.md`) still treats
    Point 6 as next ten-point item; keep phase-plan and ten-point-plan
    sequencing language synchronized during Phase 5 execution kickoff.

### 2026-03-01 - semanticShape Invariants Activated (Metadata-to-Contract Upgrade)

- What changed:
  - Extended `packages/cesr/test/unit/dispatch-spec-invariants.test.ts` with
    semantic-shape contract checks over `ATTACHMENT_DISPATCH_SPEC`.
  - Added invariant assertions that each `semanticShape` enforces expected
    parser-kind/flag structure (e.g., wrapper vs tuple vs genus marker
    semantics).
  - Added full shape-presence assertion so all semantic categories remain
    represented and auditable as the dispatch spec evolves.
- Why:
  - `semanticShape` was previously informational metadata; invariants now make
    it an enforceable contract for maintainability and review safety.
- Tests:
  - Command: `deno task test` (in `packages/cesr`)
  - Result: `120 passed, 0 failed`
- Contracts/plans touched:
  - `docs/design-docs/PROJECT_LEARNINGS.md`
- Risks/TODO:
  - If new semantic shapes are introduced in Phase 5/6 work, extend invariants
    intentionally in the same PR to preserve exhaustive coverage.

### 2026-03-01 - Point 6 Task Definition Recalibration After Points 3/4 Overlap Review

- What changed:
  - Re-scoped Point 6 in readability planning docs from broad policy+mode work
    to a focused observability/diagnostics slice.
  - Recorded that explicit/configurable recovery baseline already exists through
    Point 3 strategy injection and Point 4 typed opaque wrapper-tail payloads.
  - Updated roadmap Phase 3 wording to mark policy extraction complete and keep
    remaining Point 6 work queued after Phase 5.
- Why:
  - Prevent duplicate implementation effort and keep remaining recovery work
    aligned with actual code gaps (`console.warn` fallback path and lack of
    unified structured recovery diagnostics).
- Tests:
  - Command: not run (documentation-only recalibration)
  - Result: n/a
- Contracts/plans touched:
  - `docs/plans/cesr/cesr-parser-readability-improvement-plan.md`
  - `docs/plans/cesr/cesr-parser-readability-phased-roadmap.md`
- Risks/TODO:
  - Ensure final Point 6 implementation adds a concrete diagnostics contract
    before removing legacy warning behavior so downstream observability is not
    regressed.

### 2026-03-01 - Phase 5 Minor-Version Model + Codex Subset Parity Implementation

- What changed:
  - Added `packages/cesr/src/tables/counter-version-registry.ts` with explicit
    versioned codex registries:
    - `CtrDexByVersion`
    - `UniDexByVersion`
    - `SUDexByVersion`
    - `MUDexByVersion`
  - Added generic major/minor resolver semantics
    (`resolveVersionedRegistryValue`) that bind to latest supported compatible
    minor within a major and reject unsupported future minor requests.
  - Wired `packages/cesr/src/primitives/counter.ts` to resolve size/name tables
    via versioned registries instead of `major >= 2` branching.
  - Wired `packages/cesr/src/parser/group-dispatch.ts` to resolve dispatch maps
    and siger-list code sets via versioned registries instead of major-only
    table selection.
  - Added explicit legacy compatibility alias allowlist
    (`LEGACY_COMPAT_COUNTER_CODES_BY_VERSION`) for v1 `-J/-K` sad-path entries.
  - Added invariants/tests:
    - `packages/cesr/test/unit/counter-version-registry.test.ts`
    - extended `packages/cesr/test/unit/dispatch-spec-invariants.test.ts` with
      codex/subset/legacy alias coverage and dispatch-to-codex alignment checks.
- Why:
  - Complete roadmap Phase 5 so version semantics and codex subset concepts are
    explicit, auditable, and aligned with KERIpy conceptual layering.
- Tests:
  - Command: `deno task test` (in `packages/cesr`)
  - Result: `128 passed, 0 failed`
- Contracts/plans touched:
  - `docs/plans/cesr/cesr-parser-readability-phased-roadmap.md`
- Risks/TODO:
  - Point 6 observability work still needs to remove default warning side
    effects and introduce one structured diagnostics contract.

### 2026-03-01 - Readability Plan Steps 6-10 Recalibration (Post-Phase 5)

- What changed:
  - Updated `docs/plans/cesr/cesr-parser-readability-improvement-plan.md`
    sections 6-10 to match the current readability baseline and completed Phase
    5 work.
  - Clarified Point 6 as the immediate next active implementation step
    (diagnostics-focused, no new fallback semantics).
  - Narrowed Point 7 to targeted syntax-artifact boundary extraction in
    high-coupling paths.
  - Updated Point 8 status to “in progress” with completed Phase 5
    parity/invariant tests acknowledged.
  - Reaffirmed Point 9 docs-first targeted naming cleanup and Point 10
    benchmark-gated deferred perf posture.
- Why:
  - Keep remaining roadmap scope realistic and avoid over-scoping now that
    parser readability and version-model clarity have materially improved.
- Tests:
  - Command: not run (docs-only recalibration)
  - Result: n/a
- Contracts/plans touched:
  - `docs/plans/cesr/cesr-parser-readability-improvement-plan.md`
- Risks/TODO:
  - Keep phased roadmap and improvement-plan status language synchronized as
    Point 6 implementation lands.

### 2026-03-01 - Point 6 Recovery Observability Implementation

- What changed:
  - Added typed `RecoveryDiagnostic` contract and observer adapter in
    `packages/cesr/src/core/recovery-diagnostics.ts`.
  - Wired parser/dispatch observability hooks so recovery emits structured
    diagnostics for:
    - accepted version fallback retry,
    - rejected version fallback,
    - wrapper opaque-tail preservation,
    - parser non-shortage error + reset.
  - Removed default `console.warn` behavior from compat fallback policy and
    preserved callback compatibility through diagnostics adapter wiring.
  - Added focused diagnostics tests in
    `packages/cesr/test/unit/parser-recovery-diagnostics.test.ts`.
- Why:
  - Complete Point 6 by unifying recovery observability under one typed contract
    while preserving strict/compat semantics.
- Tests:
  - Command: `deno task test` (in `packages/cesr`)
  - Result: `132 passed, 0 failed`
- Contracts/plans touched:
  - `docs/plans/cesr/cesr-parser-readability-improvement-plan.md`
  - `docs/plans/cesr/cesr-parser-readability-phased-roadmap.md`
- Risks/TODO:
  - Keep `onAttachmentVersionFallback` adapter behavior stable until downstream
    consumers migrate to `onRecoveryDiagnostic`.

### 2026-03-01 - Test Fixture Consolidation for Repeated CESR Unit Builders

- What changed:
  - Added descriptive shared fixture modules for repeated test constructors:
    - `packages/cesr/test/fixtures/stream-byte-fixtures.ts`
    - `packages/cesr/test/fixtures/counter-token-fixtures.ts`
    - `packages/cesr/test/fixtures/versioned-body-fixtures.ts`
  - Migrated unit tests to import these fixtures instead of redefining local
    `encode`, `counterV1/counterV2`, `sigerToken`, `token`, `v1ify/v2ify`,
    `minimalV1MgpkBody/minimalV1CborBody`, and chunk-boundary builders.
- Why:
  - Reduce test duplication and keep fixture behavior consistent across parity,
    parser, annotate, and primitive suites.
- Tests:
  - Command: `deno task test` (in `packages/cesr`)
  - Result: `132 passed, 0 failed`
- Contracts/plans touched:
  - none (test-only refactor)
- Risks/TODO:
  - none

### 2026-03-01 - Point 7 Syntax/Semantic Boundary Separation (Targeted Scope)

- What changed:
  - Refactored frame-start parsing in
    `packages/cesr/src/core/parser-frame-parser.ts` into explicit syntax
    extraction (`parseFrameStartSyntax`) followed by semantic interpretation
    (`interpretFrameStartSyntax`).
  - Refactored native-body parsing in
    `packages/cesr/src/core/parser-frame-parser.ts` into syntax artifact
    construction (`parseNativeBodySyntax` + token helpers) and semantic
    projection (`interpretNativeMetadataSyntax` / `interpretNativeFieldSyntax`).
  - Added mapper-level syntax/semantic split in
    `packages/cesr/src/primitives/mapper.ts`:
    - `parseMapperBodySyntax` for token artifacts
    - `interpretMapperBodySyntax` for labeled semantic fields
    - `parseMapperBody` retained as compatibility wrapper.
  - Added explicit boundary error classes in `packages/cesr/src/core/errors.ts`:
    - `SyntaxParseError`
    - `SemanticInterpretationError`
  - Added/updated tests:
    - `packages/cesr/test/unit/primitives-native.test.ts`
    - `packages/cesr/test/unit/parser-wrapper-map-errors.test.ts`
- Why:
  - Complete Point 7 by separating token parsing from semantic interpretation in
    the highest-coupling paths while preserving bounded atomic parser
    architecture.
- Tests:
  - Command: `deno task test` (in `packages/cesr`)
  - Result: `135 passed, 0 failed`
- Contracts/plans touched:
  - `docs/plans/cesr/cesr-parser-readability-improvement-plan.md`
  - `docs/plans/cesr/cesr-parser-readability-phased-roadmap.md`
- Risks/TODO:
  - Maintain current classification boundary for parser-level errors to avoid
    accidental drift in downstream expectations during Point 8 hardening.

### 2026-03-01 - Point 8 KERIpy Parity Hardening: Initial Evidence-Pack Locks

- What changed:
  - Added `packages/cesr/test/hardening/parser-keripy-golden-corpus.test.ts`
    with three Point 8 P2 vectors:
    - `V-P2-017`: KERIpy-derived golden corpus txt/qb2 parity and
      split-determinism locks.
    - `V-P2-018`: selected KERIpy codex/subset drift sentinel locks (`CtrDex`,
      `UniDex`, `SUDex`, `MUDex`).
    - `V-P2-019`: historical implicit-v1 stream sample lock (no selector
      counters).
  - Added `KERIPY_V1_JSON_ICP_BODY` fixture in
    `packages/cesr/test/fixtures/external-vectors.ts` from
    `keripy/tests/core/test_parsing.py`.
  - Updated Point 8 status/progress language in:
    - `docs/plans/cesr/cesr-parser-readability-improvement-plan.md`
    - `docs/plans/cesr/cesr-parser-p2-hardening-interop-plan.md`
- Why:
  - Expand Point 8 parity evidence with explicit KERIpy-oriented behavioral
    locks while keeping remaining P2 breadth vectors visible and scoped.
- Tests:
  - Command: `deno task test` (in `packages/cesr`)
  - Result: `138 passed, 0 failed`
- Contracts/plans touched:
  - `docs/plans/cesr/cesr-parser-readability-improvement-plan.md`
  - `docs/plans/cesr/cesr-parser-p2-hardening-interop-plan.md`
- Risks/TODO:
  - Remaining P2 vectors (`V-P2-001`..`016`, `V-P2-020`, `V-P2-021`) are still
    pending before broad rollout confidence.

### 2026-03-01 - Point 9 Naming and Terminology Normalization (Targeted Docs-First Pass)

- What changed:
  - Added explicit parser terminology glossaries and normalized wording in:
    - `docs/design-docs/cesr-parser/CESR_PARSER_MAINTAINER_GUIDE.md`
    - `docs/design-docs/CESR_PARSER_STATE_MACHINE_CONTRACT.md`
  - Clarified frame/message terminology boundary without public API churn:
    - `packages/cesr/src/core/types.ts` now documents `CesrMessage` as a
      historical compatibility name for frame payload objects.
  - Applied targeted ambiguity-reducing cleanup in parser/annotate code:
    - `packages/cesr/src/annotate/annotator.ts` (`framesOrThrow` ->
      `parsedFramesOrThrow`, `messages` -> `parsedFrames`)
    - `packages/cesr/src/core/parser-attachment-collector.ts` comment
      normalization for frame-boundary semantics.
  - Updated plan/roadmap status to mark Point 9 complete and Phase 1
    docs/terminology work complete:
    - `docs/plans/cesr/cesr-parser-readability-improvement-plan.md`
    - `docs/plans/cesr/cesr-parser-readability-phased-roadmap.md`
- Why:
  - Complete Point 9 with glossary-led terminology alignment and reduce review
    friction around frame/message naming while avoiding broad rename-only churn.
- Tests:
  - Command: `deno task test` (in `packages/cesr`)
  - Result: `138 passed, 0 failed`
- Contracts/plans touched:
  - `docs/design-docs/CESR_PARSER_STATE_MACHINE_CONTRACT.md`
  - `docs/plans/cesr/cesr-parser-readability-improvement-plan.md`
  - `docs/plans/cesr/cesr-parser-readability-phased-roadmap.md`
- Risks/TODO:
  - Preserve `CesrMessage` exported type name for compatibility until a
    deliberate public API migration path is approved.

### 2026-03-01 - Point 10 Benchmark Gating and `tufa` CESR Benchmark Command

- What changed:
  - Added reusable benchmark abstraction for parser runs and metrics:
    - `packages/cesr/src/bench/parser-benchmark.ts`
  - Added standard benchmark flows in `packages/cesr`:
    - baseline suite `packages/cesr/bench/parser.bench.ts`
    - arbitrary-stream CLI `packages/cesr/src/bench/cli-deno.ts`
    - tasks `deno task bench:cesr` and `deno task bench:cesr:parser`.
  - Wired benchmark execution into `tufa`:
    - `tufa benchmark cesr --in <path>` or stdin stream.
  - Added focused tests:
    - `packages/cesr/test/unit/parser-benchmark.test.ts`
    - `packages/keri/test/unit/app/benchmark.test.ts`
  - Updated readability/perf planning docs to mark Point 10 complete and
    document rollback criteria.
- Why:
  - Establish benchmark evidence as the required gate before any parser buffer
    optimization, while keeping optimization internals behind readable
    abstractions and stable command entrypoints.
- Tests:
  - Command: `deno task test` (in `packages/cesr`)
  - Result: `140 passed, 0 failed`
  - Command:
    `deno test --allow-all --unstable-ffi test/unit/app/benchmark.test.ts` (in
    `packages/keri`)
  - Result: `2 passed, 0 failed`
  - Command: `deno task bench:cesr`
  - Result: benchmark suite executed and reported parser baseline timings
  - Command:
    `deno task tufa benchmark cesr --in ../../samples/cesr-streams/CESR_1_0-oor-auth-vc.cesr --iterations 1 --warmup 0 --chunk-size 128`
  - Result: benchmark command executed successfully and emitted metrics
- Contracts/plans touched:
  - `docs/plans/cesr/cesr-parser-readability-improvement-plan.md`
  - `docs/plans/cesr/cesr-parser-readability-phased-roadmap.md`
  - `docs/plans/cesr/cesr-parser-buffer-perf-plan.md`
- Risks/TODO:
  - Remaining Point 8 P2 breadth vectors are still pending and remain the next
    parser hardening milestone in Phase 6.

### 2026-03-02 - `tufa annotate --colored` Feasibility Assessment

- Topic docs updated:
  - `docs/design-docs/learnings/PROJECT_LEARNINGS_CESR.md`
- What changed:
  - Assessed implementation scope for adding optional ANSI colorized output to
    `tufa annotate` (`--colored`) with semantic emphasis on counters/groups,
    message body, signatures/indexers, and SAID metadata.
  - Mapped likely touchpoints:
    - `packages/keri/src/app/cli/command-definitions.ts`
    - `packages/keri/src/app/cli/annotate.ts`
    - optionally `packages/cesr/src/annotate/cli.ts` for CLI parity
    - a new annotate colorizer utility module in `packages/cesr/src/annotate/`
      or `packages/keri/src/app/cli/`.
  - Identified main design constraint: preserve deterministic plain annotation
    output and `annotate`/`denot` contracts by keeping colorization as an opt-in
    presentation layer, not a renderer/parser contract change.
- Why:
  - Capture decision-ready effort/risk guidance before implementation so
    maintainers can choose MVP (post-render coloring) vs deeper semantic
    renderer integration.
- Tests:
  - Command: not run (analysis-only task)
  - Result: n/a
- Contracts/plans touched:
  - none
- Risks/TODO:
  - Keep file output and non-TTY behavior explicit for `--colored` (avoid
    unwanted ANSI escape persistence unless user opts in).
  - If future requirements demand precise token-level coloring inside JSON
    bodies and comments, consider introducing typed color segments at renderer
    boundaries instead of regex-only post-processing.

### 2026-03-02 - `tufa annotate --colored` Implementation

- Topic docs updated:
  - `docs/design-docs/learnings/PROJECT_LEARNINGS_CESR.md`
- What changed:
  - Added `--colored` flag to `tufa annotate` command wiring and command args.
  - Added CLI-only annotation colorizer utility:
    - `packages/keri/src/app/cli/annotate-color.ts`
  - Implemented optional user color configuration loading from:
    - `$HOME/.tufa/annot-color.yaml`
    - `$HOME/.tufa/annot-color.yml`
  - Enforced output contract:
    - ANSI colorization is applied only when `--colored` is set and output is
      stdout.
    - `--out` file writes always remain plain, uncolored annotation text.
  - Added tests in `packages/keri/test/unit/app/annotate.test.ts` for:
    - stdout ANSI output when `--colored` is enabled
    - no ANSI in `--out` output even with `--colored`
    - valid HOME YAML override application
  - Updated user docs:
    - `README.md`
    - `packages/keri/README.md`
- Why:
  - Improve human readability for CESR annotation output while preserving
    deterministic plain-text annotation and existing annotate/denot behavior for
    files and downstream tooling.
- Tests:
  - Command:
    `deno test --allow-all --unstable-ffi test/unit/app/annotate.test.ts` (in
    `packages/keri`)
  - Result: `4 passed, 0 failed`
  - Command: `deno check src/app/cli/annotate.ts src/app/cli/annotate-color.ts`
    (in `packages/keri`)
  - Result: type check passed
- Contracts/plans touched:
  - none
- Risks/TODO:
  - Current config parser intentionally supports a strict simple YAML mapping
    subset (`key: value`) for offline/no-dependency robustness.
  - If broader YAML features are required later (anchors, nested maps, etc.),
    migrate to a full parser dependency with explicit runtime availability.

### 2026-03-02 - `--colored --pretty` JSON Body Coloring Fix

- Topic docs updated:
  - `docs/design-docs/learnings/PROJECT_LEARNINGS_CESR.md`
- What changed:
  - Fixed colorizer behavior so pretty-printed multi-line SERDER JSON bodies are
    fully colored (not just opening/closing lines) when `tufa annotate` is run
    with both `--colored` and `--pretty`.
  - Added regression coverage in `packages/keri/test/unit/app/annotate.test.ts`:
    - `CLI - tufa annotate --colored --pretty colors pretty JSON body lines`
- Why:
  - Align colored output behavior with user expectations for readable JSON body
    highlighting in pretty mode.
- Tests:
  - Command:
    `deno test --allow-all --unstable-ffi test/unit/app/annotate.test.ts` (in
    `packages/keri`)
  - Result: `5 passed, 0 failed`
- Contracts/plans touched:
  - none
- Risks/TODO:
  - Pretty-body detection currently uses line-oriented heuristics tied to
    annotate output shape; if annotate formatting modes expand, keep this state
    path covered by regression tests.

### 2026-03-03 - KERIpy `main` Primitive Parity Refresh

- Topic docs updated:
  - `docs/design-docs/learnings/PROJECT_LEARNINGS_CESR.md`
- What changed:
  - Revalidated primitive codex/class behavior against `keripy` `main`
    (`5a5597e8`) and aligned known drifts in `packages/cesr/src/primitives`.
  - Added missing primitive classes:
    - `Tagger` (`tagger.ts`)
    - `Decimer` (`decimer.ts`)
  - Added shared code-subset registry (`primitives/codex.ts`) for semantic codex
    checks (`DIGEST_CODES`, `NONCE_CODES`, `TAG_CODES`, `LABELER_CODES`,
    `DECIMAL_CODES`, etc.) to avoid ambiguous one-name-per-code assumptions.
  - Updated class hierarchy/validators to reflect KERIpy `main` behavior:
    - `Noncer` now extends `Diger` (non-strict digest validation path) and
      validates full `NonceCodex` subset.
    - `Verser` now extends `Tagger`, validates `Tag7/Tag10` (`Y`/`0O`) and
      parses protocol/pvrsn/gvrsn from tag semantics.
    - `Ilker` and `Traitor` now leverage `Tagger` tag semantics directly;
      `Traitor` validates against `TraitDex` values (`EO`, `DND`, `RB`, `NB`,
      `NRB`, `DID`).
    - `Labeler` now validates against expanded `LabelCodex` and decodes tag/bext
      text semantics instead of `V/W`-only assumptions.
  - Updated `Bexter`/`Pather` decode behavior to use KERIpy-like rawify/derawify
    handling for `StrB64*` codes.
  - Export surface updated in `src/index.ts` for new primitives/codex module.
- Why:
  - Ensure primitive-first hydration work tracks the newest KERIpy primitive
    model and does not retain v1.3.4-specific assumptions in semantic
    validators.
- Tests:
  - Command: `deno check src/index.ts` (in `packages/cesr`)
  - Result: type check passed
  - Command:
    `deno test test/unit/primitives-native.test.ts test/unit/qb2.test.ts` (in
    `packages/cesr`)
  - Result: `52 passed, 0 failed`
- Contracts/plans touched:
  - none
- Risks/TODO:
  - Full-suite migration to primitive-graph attachment assertions remains
    in-flight; several parser wrapper tests still require update from legacy
    wrapper-item expectations to `Primitive`/`CounterGroup` graph assertions.

### 2026-03-04 - Primitive Maintainer Docstrings (KERIpy-Substance Pass)

- Topic docs updated:
  - `docs/design-docs/learnings/PROJECT_LEARNINGS_CESR.md`
- What changed:
  - Added principal-engineer/maintainer-oriented docstrings to newly added and
    newly aligned CESR primitive modules (`UnknownPrimitive`, `Tagger`,
    `Decimer`, `Labeler`, `Bexter`, `Pather`, `Noncer`, `Verser`, `Ilker`,
    `Traitor`, plus signer/cipher key-material subclasses).
  - Docstrings explicitly capture KERIpy-substance at class/function boundaries:
    responsibility, codex invariants, semantic projections, and parse boundary
    contracts.
  - Added/expanded method-level docs for non-obvious behavior (for example:
    `Labeler.label/text` distinction, `Bexter.rawify/derawify`, `Verser`
    `pvrsn/gvrsn` decoding, `Noncer` empty-nonce roundtrip contract).
- Why:
  - Make primitive architecture and invariants reviewable for maintainers during
    the ongoing primitive-first hydration migration.
- Tests:
  - Command: `deno check src/index.ts` (in `packages/cesr`)
  - Result: type check passed
- Contracts/plans touched:
  - none
- Risks/TODO:
  - Remaining parser test migration from legacy wrapper item shapes to
    primitive-graph typing is still pending and unaffected by doc-only updates.

### 2026-03-04 - Primitive Doc Completion Follow-up

- Topic docs updated:
  - `docs/design-docs/learnings/PROJECT_LEARNINGS_CESR.md`
- What changed:
  - Completed missing docstrings for primitives/functions still lacking docs
    after the initial pass, including `Verfer` and core base families (`Matter`,
    `Indexer`, `Counter`) plus grouped primitive parsers
    (`Aggor`/`Blinder`/`Mediar`/`Sealer`).
  - Added class/function docs with KERIpy-substance for role/invariants and
    parse-domain boundary contracts.
- Why:
  - Close remaining maintainer-documentation gaps in the primitive-first
    hydration refactor so review context is complete at primitive boundaries.
- Tests:
  - Command: `deno check src/index.ts` (in `packages/cesr`)
  - Result: type check passed
- Contracts/plans touched:
  - none
- Risks/TODO:
  - Full-suite parser test migration to primitive graph typing remains the
    active non-doc follow-up.

### 2026-03-04 - Primitive-First Parser Test Migration and Annotate Native-Body Rendering Fix

- Topic docs updated:
  - `docs/design-docs/learnings/PROJECT_LEARNINGS_CESR.md`
- What changed:
  - Completed parser-test migration from legacy wrapper-shape assertions
    (`AttachmentItem.kind/qb64/opaque`) to primitive-first graph assertions
    (`CounterGroup`, `UnknownPrimitive`, tuple/runtime narrowing) in:
    - `test/hardening/parser-p2-high-priority-hardening.test.ts`
    - `test/unit/parser-version-context.test.ts`
    - `test/unit/parser-wrapper-map-errors.test.ts`
    - `test/unit/parser-wrapper-version-context.test.ts`
  - Added per-primitive test files for all primitive modules and converted
    aggregate primitive suites to smoke coverage (`primitives-native.test.ts`,
    `qb2.test.ts`).
  - Updated native map-body fixtures/hardening helpers to use `Labeler`
    primitive label tokens (`0J_*`) instead of legacy `VAAA` placeholders.
  - Fixed annotate native-body rendering to tokenize directly from raw native
    body bytes (counter/matter stream) so `denot(annotate(...))` remains
    parseable and deterministic for primitive-first native bodies.
- Why:
  - Preserve parser/annotate behavior under the new primitive-first hydration
    contract and close remaining regressions introduced by the wrapper-shape to
    primitive-graph transition.
- Tests:
  - Command: `deno test test/unit/primitives` (in `packages/cesr`)
  - Result: `116 passed, 0 failed`
  - Command:
    `deno test test/hardening/parser-p2-high-priority-hardening.test.ts test/unit/parser-version-context.test.ts test/unit/parser-wrapper-map-errors.test.ts test/unit/parser-wrapper-version-context.test.ts`
    (in `packages/cesr`)
  - Result: `18 passed, 0 failed`
  - Command: `deno task test` (in `packages/cesr`)
  - Result: `228 passed, 0 failed`
- Contracts/plans touched:
  - `docs/design-docs/CESR_PARSER_STATE_MACHINE_CONTRACT.md` (no semantic change
    required; contract coverage restored by migrated tests)
- Risks/TODO:
  - Interop/KLI flows may still be pinned to KERIpy `v1.3.4` while primitive
    parity work tracks KERIpy `main`; keep this split explicit in future test
    expectations until upstream main stabilizes for those flows.

### 2026-03-04 - Structor Family + Serder Integration Test Expansion

- Topic docs updated:
  - `docs/design-docs/learnings/PROJECT_LEARNINGS_CESR.md`
- What changed:
  - Added KERIpy-main-derived structor vectors to
    `packages/cesr/test/fixtures/keripy-primitive-vectors.ts` (`Aggor`
    empty-list baseline, `Sealer`/`Blinder`/`Mediar` payload vectors).
  - Expanded per-primitive suites:
    - `test/unit/primitives/structor.test.ts`
    - `test/unit/primitives/aggor.test.ts`
    - `test/unit/primitives/sealer.test.ts`
    - `test/unit/primitives/blinder.test.ts`
    - `test/unit/primitives/mediar.test.ts`
  - Expanded `test/unit/serder-classes.test.ts` with:
    - `SerderKERI`/`SerderACDC` constructor-domain rejection coverage
    - nested-wrapper structor projection coverage (`sealer` + `other`)
    - malformed JSON decode error wrapping coverage.
- Why:
  - Increase KERIpy-reference evidence depth for the newly introduced `Structor`
    family and lock parser-to-serder integration behavior through typed
    projection assertions.
- Tests:
  - Command:
    `deno test test/unit/primitives/structor.test.ts test/unit/primitives/aggor.test.ts test/unit/primitives/sealer.test.ts test/unit/primitives/blinder.test.ts test/unit/primitives/mediar.test.ts test/unit/serder-classes.test.ts`
    (in `packages/cesr`)
  - Result: `25 passed, 0 failed`
  - Command: `deno test test/unit/primitives` (in `packages/cesr`)
  - Result: `126 passed, 0 failed`
  - Command: `deno task test` (in `packages/cesr`)
  - Result: `244 passed, 0 failed`
- Contracts/plans touched:
  - none (test/fixture scope only)
- Risks/TODO:
  - Canonical KERIpy enclosed v2 vectors for some tuple-family counters
    (`-W/-a/-c`) currently require counter normalization in TS tests; parser
    parity for native v2 quadlet-count semantics on these tuple families should
    be closed in a follow-up parser workstream.
