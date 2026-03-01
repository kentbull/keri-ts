# PROJECT_LEARNINGS_CESR

## Purpose

Persistent CESR parser memory for `keri-ts`.

## Current State

### 2026-03-01

1. **Ten-point plan status**
- Point 1 (`Publish an explicit parser state machine contract`) is complete as of 2026-02-28.
- Point 2 (`Decompose CesrParser into focused collaborators`) is complete as of 2026-02-28.
- Point 3 (`Replace boolean policy branching with strategy interfaces`) is complete as of 2026-03-01.
- Point 4 (`Replace unknown[] attachment payloads with discriminated types`) is complete as of 2026-03-01.
- Point 5 (`Convert dispatch definitions to a single declarative spec`) is complete as of 2026-03-01.
- Point 6 (`Make recovery behavior explicit, configurable, and observable`) is complete as of 2026-03-01 with structured recovery diagnostics and removal of default warning side effects.

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
- `compat`: fallback on unknown/deserialize errors with structured diagnostics; legacy fallback callback is adapter-backed for backward compatibility.
- v1/v2 dispatch maps, wrapper-code sets, and siger-list allowances are generated from one declarative descriptor spec.

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
- `AttachmentGroup.items` now uses a discriminated `AttachmentItem` union (`qb64`, `qb2`, `tuple`, `group`).
- Wrapper opaque-tail fallback units are explicit via `opaque: true` on `qb64`/`qb2` items.
- Primitive wrappers (`Sealer`, `Blinder`, `Mediar`, `Aggor` list mode) now expose typed items instead of `unknown[]`.

13. **Phase 5 minor-version + codex subset parity**
- `CtrDexByVersion`, `UniDexByVersion`, `SUDexByVersion`, and `MUDexByVersion` are now explicit `(major, minor)` registries with resolver semantics aligned to KERIpy-style latest-compatible-minor binding.
- `parseCounter` and attachment dispatch/siger-set lookup now resolve through versioned registries instead of `major >= 2` branching.
- Legacy v1 `-J/-K` compatibility aliases are explicitly tracked as allowlisted exceptions (not first-class entries in `CtrDexByVersion`), with invariants ensuring auditable behavior.

14. **Readability plan tail (Points 6-10) recalibrated**
- Point 6 is complete with one `RecoveryDiagnostic` contract (`version-fallback-accepted`, `version-fallback-rejected`, `wrapper-opaque-tail-preserved`, `parser-error-reset`) at parser/dispatch boundaries.
- Point 7 is complete with targeted syntax-artifact extraction in high-coupling paths (frame start + native body + mapper tokenization), without a global two-pass rewrite.
- Point 8 status is now “in progress” with completed Phase 5 parity/invariant coverage acknowledged and P2 breadth still remaining.
- Point 9 remains docs-first and targeted (no broad rename churn).
- Point 10 remains deferred and benchmark-gated after critical Point 8 hardening.

15. **Test fixture organization**
- Common CESR test builders are centralized in descriptive fixture modules:
  - `test/fixtures/stream-byte-fixtures.ts`
  - `test/fixtures/counter-token-fixtures.ts`
  - `test/fixtures/versioned-body-fixtures.ts`
- Unit tests no longer duplicate local `encode`/`counterV*`/`sigerToken`/`v*ify` helper definitions.

16. **Point 7 syntax/semantic boundary model**
- `parseFrame()` now runs through explicit syntax artifact extraction then semantic frame-kind interpretation.
- Native body parsing now builds syntax artifacts first, then projects metadata/fields in dedicated semantic helpers.
- Mapper now exposes first-class syntax (`parseMapperBodySyntax`) and semantic (`interpretMapperBodySyntax`) APIs.
- Boundary-specific error classes now distinguish token/syntax failures (`SyntaxParseError`) from semantic projection failures (`SemanticInterpretationError`).

## Key Docs

1. `docs/design-docs/CESR_PARSER_STATE_MACHINE_CONTRACT.md`
2. `docs/design-docs/CESR_ATOMIC_BOUNDED_PARSER_ARCHITECTURE.md`
3. `docs/plans/cesr-parser-readability-improvement-plan.md`
4. `docs/plans/cesr-parser-readability-phased-roadmap.md`
5. `docs/plans/cesr-parser-phase0-behavior-lock-parity-matrix.md`
6. `docs/plans/cesr-parser-p2-hardening-interop-plan.md`
7. `docs/adr/adr-0001-parser-atomic-bounded-first.md`

## Current Follow-Ups

1. Keep lifecycle contract matrix synchronized with diagnostics and recovery behavior tests.
2. Execute P2 hardening vectors prior to broad ecosystem rollout.
3. Continue Point 8 parity hardening vectors (P2 breadth) now that Point 7 boundary extraction is complete.
4. Monitor downstream migration from legacy `onAttachmentVersionFallback` toward `onRecoveryDiagnostic`.

## Handoff Log

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
  - state machine contract, parity matrix, roadmap/improvement docs, architecture guide.
- Risks/TODO:
  - Preserve mapping discipline as decomposition proceeds.

### 2026-02-28 - Point 1 Completion Reflected in Learnings/Plan
- What changed:
  - Explicitly recorded Point 1 completion and Point 2 next-step status in CESR learnings current-state section.
  - Synced milestone language with `cesr-parser-readability-improvement-plan.md`.
- Why:
  - Keep thread handoff state unambiguous and aligned across learnings + execution plan docs.
- Tests:
  - Command: not run (documentation-only update)
  - Result: n/a
- Contracts/plans touched:
  - `docs/plans/cesr-parser-readability-improvement-plan.md`
- Risks/TODO:
  - Maintain milestone/status sync as Point 2 decomposition work lands.

### 2026-02-28 - Point 2 CesrParser Collaborator Decomposition
- What changed:
  - Split parser responsibilities into focused collaborators:
    - `packages/cesr/src/core/parser-stream-state.ts` (buffer/cursor + stream version state),
    - `packages/cesr/src/core/parser-deferred-frames.ts` (`pendingFrame`/`queuedFrames` lifecycle),
    - `packages/cesr/src/core/parser-frame-parser.ts` (frame-start and body-group parsing),
    - `packages/cesr/src/core/parser-attachment-collector.ts` (attachment continuation/collection),
    - `packages/cesr/src/core/parser-constants.ts` (shared parser constants/helpers).
  - Reduced `packages/cesr/src/core/parser-engine.ts` to orchestration control flow over collaborators.
  - Preserved lifecycle contract behavior including pending-vs-queued ordering and split determinism.
- Why:
  - Complete Point 2 readability milestone by isolating responsibilities and reducing branch fan-out in parser orchestration.
- Tests:
  - Command: `deno task test` (in `packages/cesr`)
  - Result: `118 passed, 0 failed`
- Contracts/plans touched:
  - `docs/plans/cesr-parser-readability-improvement-plan.md`
- Risks/TODO:
  - Point 3 policy extraction should avoid changing default strict/compat semantics while introducing strategy interfaces.

### 2026-03-01 - Point 3 Strategy Interface Extraction
- What changed:
  - Added `FrameBoundaryPolicy` strategy interface and default implementations in `packages/cesr/src/core/parser-policy.ts`.
  - Refactored `parser-engine`, `parser-frame-parser`, and `parser-attachment-collector` to consume injected `FrameBoundaryPolicy` instead of branching on `framed`.
  - Added `AttachmentVersionFallbackPolicy` strategy interface with strict/compat implementations and factories in `packages/cesr/src/parser/group-dispatch.ts`.
  - Refactored attachment dispatch and wrapper recovery paths to delegate strict/compat behavior to fallback policy strategies instead of mode branching.
  - Preserved API compatibility by mapping legacy options (`framed`, `attachmentDispatchMode`, `onAttachmentVersionFallback`) into default strategy instances.
- Why:
  - Complete Point 3 by removing scattered policy conditionals and making parser behavior choices explicit, injectable, and testable.
- Tests:
  - Command: `deno task test` (in `packages/cesr`)
  - Result: `118 passed, 0 failed`
- Contracts/plans touched:
  - `docs/plans/cesr-parser-readability-improvement-plan.md`
  - `docs/plans/cesr-parser-readability-phased-roadmap.md`
- Risks/TODO:
  - Point 4 still needs compatibility-aware migration from `AttachmentGroup.items: unknown[]` to discriminated payload types.

### 2026-03-01 - Policy Module Extraction Follow-Up
- What changed:
  - Moved attachment fallback policy strategy types/implementations from `packages/cesr/src/parser/group-dispatch.ts` into dedicated module `packages/cesr/src/parser/attachment-fallback-policy.ts`.
  - Kept `group-dispatch.ts` API compatibility by re-exporting fallback policy types/factories from the new module and preserving strict/compat behavior wiring.
- Why:
  - Reduce `group-dispatch.ts` length and keep policy concerns isolated from dispatch-table mechanics.
- Tests:
  - Command: `deno task test` (in `packages/cesr`)
  - Result: `118 passed, 0 failed`
- Contracts/plans touched:
  - `docs/plans/cesr-parser-readability-improvement-plan.md`
- Risks/TODO:
  - Continue keeping strategy modules focused as Point 4 typed payload refactors land.

### 2026-03-01 - Fallback Factory Surface Simplification
- What changed:
  - Removed unused convenience wrappers `createStrictAttachmentVersionFallbackPolicy` and `createCompatAttachmentVersionFallbackPolicy` from `packages/cesr/src/parser/attachment-fallback-policy.ts`.
  - Kept `createAttachmentVersionFallbackPolicy({ mode, onVersionFallback })` as the single public fallback policy factory path.
  - Preserved strict parsing entrypoint behavior in `group-dispatch.ts` by constructing strict policy via `createAttachmentVersionFallbackPolicy({ mode: "strict" })`.
- Why:
  - Reduce API surface area and avoid parallel factory paths that encode the same behavior.
- Tests:
  - Command: `deno task test` (in `packages/cesr`)
  - Result: `118 passed, 0 failed`
- Contracts/plans touched:
  - `docs/plans/cesr-parser-readability-improvement-plan.md`
- Risks/TODO:
  - If external downstream users rely on removed wrappers, add explicit migration notes in the next release notes pass.

### 2026-03-01 - Point 4 Typed Attachment Payload Migration
- What changed:
  - Replaced `AttachmentGroup.items: unknown[]` with a discriminated `AttachmentItem` union in `packages/cesr/src/core/types.ts`.
  - Refactored `packages/cesr/src/parser/group-dispatch.ts` to emit tagged payload items (`qb64`, `qb2`, `tuple`, `group`) across tuple/repeated/wrapper paths.
  - Preserved compatibility behavior for wrapper-tail recovery by tagging preserved opaque units with `opaque: true`.
  - Updated consumers (`annotate/render`, `sealer`, `blinder`, `mediar`, `aggor`) and focused tests to use discriminants instead of runtime casts.
- Why:
  - Complete Point 4 deliverables so attachment payload semantics are explicit in the public type model.
- Tests:
  - Command: `deno task test` (in `packages/cesr`)
  - Result: `118 passed, 0 failed`
- Contracts/plans touched:
  - `docs/plans/cesr-parser-readability-improvement-plan.md`
  - `docs/plans/cesr-parser-readability-phased-roadmap.md`
- Risks/TODO:
  - Downstream users that depended on raw `string | Uint8Array | object | array` item shapes must migrate to discriminant checks.

### 2026-03-01 - Point 5 Declarative Dispatch Spec Conversion
- What changed:
  - Replaced manual v1/v2 dispatch maps in `packages/cesr/src/parser/group-dispatch.ts` with descriptor-driven construction from one canonical `ATTACHMENT_DISPATCH_SPEC`.
  - Introduced a typed dispatch descriptor schema capturing version, parser kind, and semantic shape metadata, with tuple/wrapper/siger flags.
  - Derived wrapper-group code sets and siger-list allowance sets from descriptors to remove separate hand-maintained code lists.
- Why:
  - Complete Point 5 by removing duplicated dispatch wiring and reducing drift risk between parser code tables and behavior expectations.
- Tests:
  - Command: `deno task test` (in `packages/cesr`)
  - Result: `118 passed, 0 failed`
- Contracts/plans touched:
  - `docs/plans/cesr-parser-readability-improvement-plan.md`
  - `docs/plans/cesr-parser-readability-phased-roadmap.md`
- Risks/TODO:
  - Point 6 still needs structured recovery diagnostics so compat fallbacks stop relying on warning-style side effects.

### 2026-03-01 - Dispatch Spec Invariant Lock Test (Generated Tables + Legacy SAD Path Aliases)
- What changed:
  - Added `packages/cesr/test/unit/dispatch-spec-invariants.test.ts` to enforce dispatch integrity against generated counter tables.
  - Exported `ATTACHMENT_DISPATCH_SPEC` from `packages/cesr/src/parser/group-dispatch.ts` so invariants can assert coverage/uniqueness directly from the canonical spec.
  - Added explicit compatibility allowance for legacy v1 `-J/-K` entries so these remain required in dispatch routing even if future generated codex tables stop listing them.
- Why:
  - Prevent silent dispatch drift (duplicates/omissions) and preserve long-term backwards compatibility for deployed sad-path alias streams.
- Tests:
  - Command: `deno task test` (in `packages/cesr`)
  - Result: `119 passed, 0 failed`
- Contracts/plans touched:
  - `docs/plans/cesr-parser-readability-improvement-plan.md`
- Risks/TODO:
  - If new intentional compatibility-only aliases are added, update invariant allowlist explicitly to keep intent auditable.

### 2026-03-01 - Learner/Maintainer-First Design Bias Captured In Startup Instructions
- What changed:
  - Updated `AGENTS.md` with explicit guidance to prioritize learner/maintainer comprehension for parser/codex work.
  - Added explicit TypeScript bias toward compile-time typed contracts and exhaustive mappings over runtime indirection.
  - Added explicit deterministic-parser guidance for CESR/TLV behavior with policy-gated flexibility.
- Why:
  - Keep architecture choices consistent across future agent sessions and reduce drift toward dynamic but harder-to-review dispatch patterns.
- Tests:
  - Command: not run (docs-only update)
  - Result: n/a
- Contracts/plans touched:
  - `AGENTS.md`
- Risks/TODO:
  - Revisit wording if future roadmap phases intentionally require more dynamic plugin-style dispatch.

### 2026-03-01 - Roadmap Rephase: Minor-Version Modeling + Codex Subset Parity Elevated To Phase 5
- What changed:
  - Updated `docs/plans/cesr-parser-readability-phased-roadmap.md` to insert a new Phase 5 focused on:
    - explicit major/minor codex modeling aligned with KERIpy minor-version progression semantics,
    - codex subset concepts (`UniDex`/`SUDex`/`MUDex` analogs),
    - invariant coverage for subset/dispatch integrity and compatibility aliases.
  - Renumbered previous hardening/review handoff phase from Phase 5 to Phase 6.
  - Added an illustrative TypeScript subset-alias model sketch to make planned naming-indirection formalization concrete.
- Why:
  - Minor-version parity and codex-subset readability are now critical interoperability requirements, not deferred backlog.
- Tests:
  - Command: not run (documentation-only update)
  - Result: n/a
- Contracts/plans touched:
  - `docs/plans/cesr-parser-readability-phased-roadmap.md`
  - `docs/design-docs/PROJECT_LEARNINGS.md`
- Risks/TODO:
  - Improvement plan (`cesr-parser-readability-improvement-plan.md`) still treats Point 6 as next ten-point item; keep phase-plan and ten-point-plan sequencing language synchronized during Phase 5 execution kickoff.

### 2026-03-01 - semanticShape Invariants Activated (Metadata-to-Contract Upgrade)
- What changed:
  - Extended `packages/cesr/test/unit/dispatch-spec-invariants.test.ts` with semantic-shape contract checks over `ATTACHMENT_DISPATCH_SPEC`.
  - Added invariant assertions that each `semanticShape` enforces expected parser-kind/flag structure (e.g., wrapper vs tuple vs genus marker semantics).
  - Added full shape-presence assertion so all semantic categories remain represented and auditable as the dispatch spec evolves.
- Why:
  - `semanticShape` was previously informational metadata; invariants now make it an enforceable contract for maintainability and review safety.
- Tests:
  - Command: `deno task test` (in `packages/cesr`)
  - Result: `120 passed, 0 failed`
- Contracts/plans touched:
  - `docs/design-docs/PROJECT_LEARNINGS.md`
- Risks/TODO:
  - If new semantic shapes are introduced in Phase 5/6 work, extend invariants intentionally in the same PR to preserve exhaustive coverage.

### 2026-03-01 - Point 6 Task Definition Recalibration After Points 3/4 Overlap Review
- What changed:
  - Re-scoped Point 6 in readability planning docs from broad policy+mode work to a focused observability/diagnostics slice.
  - Recorded that explicit/configurable recovery baseline already exists through Point 3 strategy injection and Point 4 typed opaque wrapper-tail payloads.
  - Updated roadmap Phase 3 wording to mark policy extraction complete and keep remaining Point 6 work queued after Phase 5.
- Why:
  - Prevent duplicate implementation effort and keep remaining recovery work aligned with actual code gaps (`console.warn` fallback path and lack of unified structured recovery diagnostics).
- Tests:
  - Command: not run (documentation-only recalibration)
  - Result: n/a
- Contracts/plans touched:
  - `docs/plans/cesr-parser-readability-improvement-plan.md`
  - `docs/plans/cesr-parser-readability-phased-roadmap.md`
- Risks/TODO:
  - Ensure final Point 6 implementation adds a concrete diagnostics contract before removing legacy warning behavior so downstream observability is not regressed.

### 2026-03-01 - Phase 5 Minor-Version Model + Codex Subset Parity Implementation
- What changed:
  - Added `packages/cesr/src/tables/counter-version-registry.ts` with explicit versioned codex registries:
    - `CtrDexByVersion`
    - `UniDexByVersion`
    - `SUDexByVersion`
    - `MUDexByVersion`
  - Added generic major/minor resolver semantics (`resolveVersionedRegistryValue`) that bind to latest supported compatible minor within a major and reject unsupported future minor requests.
  - Wired `packages/cesr/src/primitives/counter.ts` to resolve size/name tables via versioned registries instead of `major >= 2` branching.
  - Wired `packages/cesr/src/parser/group-dispatch.ts` to resolve dispatch maps and siger-list code sets via versioned registries instead of major-only table selection.
  - Added explicit legacy compatibility alias allowlist (`LEGACY_COMPAT_COUNTER_CODES_BY_VERSION`) for v1 `-J/-K` sad-path entries.
  - Added invariants/tests:
    - `packages/cesr/test/unit/counter-version-registry.test.ts`
    - extended `packages/cesr/test/unit/dispatch-spec-invariants.test.ts` with codex/subset/legacy alias coverage and dispatch-to-codex alignment checks.
- Why:
  - Complete roadmap Phase 5 so version semantics and codex subset concepts are explicit, auditable, and aligned with KERIpy conceptual layering.
- Tests:
  - Command: `deno task test` (in `packages/cesr`)
  - Result: `128 passed, 0 failed`
- Contracts/plans touched:
  - `docs/plans/cesr-parser-readability-phased-roadmap.md`
- Risks/TODO:
  - Point 6 observability work still needs to remove default warning side effects and introduce one structured diagnostics contract.

### 2026-03-01 - Readability Plan Steps 6-10 Recalibration (Post-Phase 5)
- What changed:
  - Updated `docs/plans/cesr-parser-readability-improvement-plan.md` sections 6-10 to match the current readability baseline and completed Phase 5 work.
  - Clarified Point 6 as the immediate next active implementation step (diagnostics-focused, no new fallback semantics).
  - Narrowed Point 7 to targeted syntax-artifact boundary extraction in high-coupling paths.
  - Updated Point 8 status to “in progress” with completed Phase 5 parity/invariant tests acknowledged.
  - Reaffirmed Point 9 docs-first targeted naming cleanup and Point 10 benchmark-gated deferred perf posture.
- Why:
  - Keep remaining roadmap scope realistic and avoid over-scoping now that parser readability and version-model clarity have materially improved.
- Tests:
  - Command: not run (docs-only recalibration)
  - Result: n/a
- Contracts/plans touched:
  - `docs/plans/cesr-parser-readability-improvement-plan.md`
- Risks/TODO:
  - Keep phased roadmap and improvement-plan status language synchronized as Point 6 implementation lands.

### 2026-03-01 - Point 6 Recovery Observability Implementation
- What changed:
  - Added typed `RecoveryDiagnostic` contract and observer adapter in `packages/cesr/src/core/recovery-diagnostics.ts`.
  - Wired parser/dispatch observability hooks so recovery emits structured diagnostics for:
    - accepted version fallback retry,
    - rejected version fallback,
    - wrapper opaque-tail preservation,
    - parser non-shortage error + reset.
  - Removed default `console.warn` behavior from compat fallback policy and preserved callback compatibility through diagnostics adapter wiring.
  - Added focused diagnostics tests in `packages/cesr/test/unit/parser-recovery-diagnostics.test.ts`.
- Why:
  - Complete Point 6 by unifying recovery observability under one typed contract while preserving strict/compat semantics.
- Tests:
  - Command: `deno task test` (in `packages/cesr`)
  - Result: `132 passed, 0 failed`
- Contracts/plans touched:
  - `docs/plans/cesr-parser-readability-improvement-plan.md`
  - `docs/plans/cesr-parser-readability-phased-roadmap.md`
- Risks/TODO:
  - Keep `onAttachmentVersionFallback` adapter behavior stable until downstream consumers migrate to `onRecoveryDiagnostic`.

### 2026-03-01 - Test Fixture Consolidation for Repeated CESR Unit Builders
- What changed:
  - Added descriptive shared fixture modules for repeated test constructors:
    - `packages/cesr/test/fixtures/stream-byte-fixtures.ts`
    - `packages/cesr/test/fixtures/counter-token-fixtures.ts`
    - `packages/cesr/test/fixtures/versioned-body-fixtures.ts`
  - Migrated unit tests to import these fixtures instead of redefining local `encode`, `counterV1/counterV2`, `sigerToken`, `token`, `v1ify/v2ify`, `minimalV1MgpkBody/minimalV1CborBody`, and chunk-boundary builders.
- Why:
  - Reduce test duplication and keep fixture behavior consistent across parity, parser, annotate, and primitive suites.
- Tests:
  - Command: `deno task test` (in `packages/cesr`)
  - Result: `132 passed, 0 failed`
- Contracts/plans touched:
  - none (test-only refactor)
- Risks/TODO:
  - none

### 2026-03-01 - Point 7 Syntax/Semantic Boundary Separation (Targeted Scope)
- What changed:
  - Refactored frame-start parsing in `packages/cesr/src/core/parser-frame-parser.ts` into explicit syntax extraction (`parseFrameStartSyntax`) followed by semantic interpretation (`interpretFrameStartSyntax`).
  - Refactored native-body parsing in `packages/cesr/src/core/parser-frame-parser.ts` into syntax artifact construction (`parseNativeBodySyntax` + token helpers) and semantic projection (`interpretNativeMetadataSyntax` / `interpretNativeFieldSyntax`).
  - Added mapper-level syntax/semantic split in `packages/cesr/src/primitives/mapper.ts`:
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
  - Complete Point 7 by separating token parsing from semantic interpretation in the highest-coupling paths while preserving bounded atomic parser architecture.
- Tests:
  - Command: `deno task test` (in `packages/cesr`)
  - Result: `135 passed, 0 failed`
- Contracts/plans touched:
  - `docs/plans/cesr-parser-readability-improvement-plan.md`
  - `docs/plans/cesr-parser-readability-phased-roadmap.md`
- Risks/TODO:
  - Maintain current classification boundary for parser-level errors to avoid accidental drift in downstream expectations during Point 8 hardening.
