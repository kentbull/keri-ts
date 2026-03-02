# PROJECT_LEARNINGS (Index)

## Purpose

Top-level memory index for `keri-ts`. This file is the routing layer, not the
deep detail layer.

Use it to:

1. identify current focus areas,
2. locate the right topic learnings doc(s),
3. keep a concise cross-topic summary,
4. apply consistent handoff updates.

## Current Focus

1. CESR parser completeness is reconciled with a formal `GO` verdict for moving
   up-stack to LMDB/key-management/KEL/witness-watcher implementation, and Point
   8 parity breadth closure is now complete across all P2 vectors.
2. KERIpy parity preservation remains the blocking parser gate for future
   parser-adjacent changes.

## Topic Learnings Index

| Topic                          | File                                                                             | Scope                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| CESR Parser                    | `docs/design-docs/learnings/PROJECT_LEARNINGS_CESR.md`                           | Parser architecture, state machine contract, parity vectors, roadmap progress |
| Crypto Suite                   | `docs/design-docs/learnings/PROJECT_LEARNINGS_CRYPTO_SUITE.md`                   | Key material, primitives, signing/verification behavior and interop           |
| KELs                           | `docs/design-docs/learnings/PROJECT_LEARNINGS_KELS.md`                           | Event logs, state transitions, replay/verification semantics                  |
| ACDC                           | `docs/design-docs/learnings/PROJECT_LEARNINGS_ACDC.md`                           | Credential issuance/exchange semantics and data-model concerns                |
| Witness/Watcher/Observer Infra | `docs/design-docs/learnings/PROJECT_LEARNINGS_WITNESS_WATCHER_OBSERVER_INFRA.md` | Network roles, deployment, ops/interoperability notes                         |

## Context Pack Policy

At session start:

1. Read `AGENTS.md`.
2. Read this file.
3. Read only the topic doc(s) relevant to the requested task.
4. Read any contract/ADR/plan docs referenced by those topic docs.

This keeps context focused and avoids long-thread drift.

## Splitting Policy

1. Split a topic learnings doc when it grows beyond about 250 lines.
2. Caveat: keep tightly coupled notes together when splitting would reduce
   clarity.
3. Keep top-level index concise; do not duplicate deep technical detail from
   topic docs.

## Cross-Topic Snapshot

### 2026-03-02

1. Design-doc path references were synchronized with the
   `docs/design-docs/cesr-parser/` and
   `docs/design-docs/cesr-parser/initial-plan-docs/` reorganization.
2. Top-level and topic learnings now reference the moved
   reconciliation/comparison/completeness artifacts at their new locations.
3. Remaining unresolved historical references are confined to legacy analysis
   docs (`CESR_IMPLEMENTATION_ANALYSIS_*`, `codex-plan.md`) that are not part of
   the current learnings/design-doc routing set.
4. Point 8 parity hardening is now fully closed: medium/low vectors (`V-P2-003`,
   `004`, `006`, `007`, `009`, `010`, `013`, `016`, `020`, `021`) were
   implemented in new hardening suites.
5. Reconciliation rows `REQ-CESR-020`, `REQ-CESR-022`, and `REQ-CESR-024` are
   now `Implemented+Tested`, and full CESR suite baseline is
   `158 passed, 0 failed`.
6. `docs/release-versioning.md` now starts with a maintainer quick release
   checklist that compresses the operational release path (`keri-ts` only vs
   joint `cesr-ts` + `keri-ts`) into one no-fluff sequence.
7. `tufa annotate --colored` feasibility was assessed with a presentation-layer
   approach preferred: keep core annotate/denot deterministic and add opt-in
   ANSI styling in CLI output paths (`packages/keri` first, optional
   `packages/cesr` parity).
8. `tufa annotate --colored` is now implemented in `packages/keri` with
   stdout-only ANSI styling, guaranteed plain `--out` file output, and optional
   user palette overrides from `$HOME/.tufa/annot-color.yaml|yml`.
9. Follow-up bugfix completed: `--colored --pretty` now colors all pretty JSON
   body lines for SERDER output, with regression coverage in
   `packages/keri/test/unit/app/annotate.test.ts`.
10. KERI reconciliation planning was expanded from init/incept-only to a
    usability-first, two-controller interop arc in
    `docs/plans/keri/INIT_INCEPT_RECONCILIATION_PLAN.md`, adding early parity
    gates for `list`, `aid`, `ends add`, OOBI generate/resolve, direct+mailbox
    communication, and challenge generate/respond/verify.
11. Directory policy is now explicit in plan scope: preserve default `.tufa`
    isolation while providing opt-in KLI compatibility mode (`.keri`) via
    CLI/config for cross-implementation interoperability.
12. Phase 2 planning now includes a dedicated DB reconciliation artifact at
    `docs/plans/keri/DB_LAYER_RECONCILIATION_PLAN.md`, with explicit parity
    workstreams for `dbing.py`, `subing.py`, `koming.py`, `basing.py`, and
    `escrowing.py`.
13. DB-layer sequencing is now hard-gated: complete LMDB feature-by-feature
    parity first (including Suber/Komer/databaser/escrow paths), then implement
    provider abstraction for pluggable backends.
14. D0 DB parity artifacts are now seeded: a module-symbol parity workbook
    (`docs/plans/keri/DB_LAYER_PARITY_MATRIX.md`) and a K/V inventory matrix
    CSV (`docs/plans/keri/DB_LAYER_KV_PARITY_MATRIX.csv`) generated from
    KERIpy DB modules and `docs/design-docs/db/lmdb-dumper.md`.
15. D0 parity workbook was upgraded with owner lanes and concrete TS symbol
    targets, and the K/V inventory is now split into execution worklists for
    Gate A-G (`DB_LAYER_KV_GATE_AG_WORKLIST.csv`) vs Gate H backlog
    (`DB_LAYER_KV_GATE_H_BACKLOG.csv`) using current `P1/Partial` heuristics.
16. Gate A-G worklist rows now include explicit gate assignments and rationale
    columns (`gate`, `gate_rationale`) instead of heuristic-only classification,
    so each prioritized K/V row is directly traceable to gates A through G.
17. Phase 2 P0 closure now includes an explicit KLI/tufa command-output parity
    matrix (`docs/plans/keri/KLI_TUFA_COMMAND_PARITY_MATRIX.md`) and a
    matrix-driven Gate A-G interop harness
    (`packages/keri/test/integration/app/interop-gates-harness.test.ts`).
18. Phase 2 P1 has started with initial `dbing.py` symbol closure:
    `splitOnKey`, `openLMDB`, and `clearDatabaserDir` are implemented in
    `keri-ts` and moved from `Missing` to `Partial` in the DB parity matrix
    with passing unit/integration evidence.

### 2026-02-28

1. Canonical parser state-machine contract is established and test-mapped.
2. P0/P1 parity vectors are complete; breadth moved to dedicated P2 hardening
   plan.
3. Stream-order rule is explicit when `pendingFrame` and `queuedFrames` coexist.
4. Docs now link architecture, plans, ADR, and lifecycle contract as a coherent
   set.
5. `CesrParser` orchestration now delegates to focused collaborators for stream
   state, frame parsing, attachment continuation, and deferred-frame lifecycle.
6. Ten-point readability plan milestone status is explicit: Points 1 and 2
   complete, Point 3 next.

### 2026-03-01

1. Point 3 policy extraction is complete with injected `FrameBoundaryPolicy` and
   `AttachmentVersionFallbackPolicy` strategy interfaces.
2. Core parser collaborators now delegate framed/unframed cadence decisions
   through policy methods instead of boolean branches.
3. Attachment dispatch strict/compat behavior is strategy-driven and now emits
   structured recovery diagnostics instead of default warning side effects.
4. Legacy parser options remain backward-compatible by constructing default
   policies from `framed`, `attachmentDispatchMode`, and
   `onAttachmentVersionFallback`.
5. Full CESR suite remains green after refactor (`119 passed, 0 failed`).
6. Follow-up modularization moved fallback policy implementations to
   `parser/attachment-fallback-policy.ts`, reducing `group-dispatch.ts` scope
   while preserving exports/behavior.
7. Fallback policy API was simplified to one factory
   (`createAttachmentVersionFallbackPolicy`) by removing unused strict/compat
   convenience wrappers.
8. Point 4 typed attachment payload migration is complete:
   `AttachmentGroup.items` now uses discriminated `AttachmentItem` unions and
   wrapper opaque-tail fallback units are explicitly tagged.
9. Point 5 declarative dispatch-spec migration is complete: `group-dispatch.ts`
   now derives v1/v2 dispatch maps, wrapper-code sets, and siger-list allowances
   from one descriptor model keyed by version/parser-kind/semantic-shape
   metadata.
10. New dispatch-spec invariant test locks mapping integrity: every generated
    `(major, code)` must appear exactly once in `ATTACHMENT_DISPATCH_SPEC`, with
    explicit long-term legacy compatibility allowance for v1 `-J/-K` sad-path
    aliases.
11. `AGENTS.md` now explicitly encodes learner/maintainer-first and
    compile-time-typed deterministic parser design bias for future task threads.
12. Phased roadmap has been re-sequenced so minor-version model rectification
    and codex subset parity (`UniDex`/`SUDex`/`MUDex` analogs) is explicit Phase
    5 and the former hardening phase is now Phase 6.
13. `semanticShape` metadata is now enforced by invariants (parser-kind/flag
    contracts and shape-coverage assertions), shifting it from
    documentation-only to auditable specification.
14. Point 6 recovery task definition was recalibrated before implementation:
    strict/compat policy injection and typed opaque recovery artifacts were
    already complete, so remaining work was narrowed to diagnostics and
    warning-side-effect removal.
15. Phase 5 is now implemented in code/tests: parser counter and dispatch lookup
    paths resolve through explicit major/minor registries, and
    `CtrDex`/`UniDex`/`SUDex`/`MUDex` subset parity plus legacy alias allowances
    are invariant-locked.
16. Readability plan steps 6-10 remain calibrated to current maturity: Point 6
    is now complete (diagnostics-focused), Point 7 is narrowed to targeted
    boundary extraction, Point 8 is in-progress with Phase 5 parity/invariants
    complete, and Points 9/10 remain intentionally constrained.
17. Point 6 is now implemented in code/tests: parser and dispatch layers share
    one typed `RecoveryDiagnostic` observer contract covering fallback
    accepted/rejected, wrapper opaque-tail preservation, and parser error-reset
    recovery context.
18. Legacy `onAttachmentVersionFallback` behavior remains backward-compatible
    via diagnostics adapter wiring, while default compat fallback warning side
    effects (`console.warn`) are removed.
19. Full CESR suite remains green after Point 6 implementation
    (`132 passed, 0 failed`).
20. CESR unit tests now share descriptive fixture builders for stream bytes,
    counter/token construction, and versioned-body construction, replacing
    repeated local helper definitions across test files.
21. Point 7 is now complete in targeted scope: frame-start and native-body flows
    parse explicit syntax artifacts first and perform semantic interpretation in
    second-phase helpers (including mapper syntax/semantic APIs), with explicit
    `SyntaxParseError` vs `SemanticInterpretationError` boundaries.
22. Full CESR suite remains green after Point 7 implementation
    (`135 passed, 0 failed`).
23. Point 8 parity hardening has initial P2 cross-implementation evidence locks
    implemented (`V-P2-017`..`V-P2-019`) in a dedicated hardening suite
    (`parser-keripy-golden-corpus.test.ts`) with txt/qb2 corpus parity,
    codex/subset sentinels, and historical implicit-v1 stream coverage.
24. Full CESR suite remains green after initial Point 8 hardening additions
    (`138 passed, 0 failed`).
25. Point 9 naming/terminology normalization is complete in targeted docs-first
    scope: parser glossary alignment is now explicit and selective
    identifier/comment cleanup reduced frame/message ambiguity without broad
    rename churn.
26. Point 10 benchmark gating is complete: standardized parser benchmark flows
    (`deno task bench:cesr`, arbitrary-stream benchmark CLI, and
    `tufa benchmark cesr`) plus rollback criteria now gate future perf
    optimization complexity.
27. CESR parser high-priority P2 hardening vectors are now complete and passing
    (`V-P2-001`, `002`, `005`, `008`, `011`, `012`, `014`, `015`, plus prior
    `017`), with a new dedicated hardening suite in
    `packages/cesr/test/hardening/parser-p2-high-priority-hardening.test.ts`.
28. Formal reconciliation artifacts are now published for parser readiness:

- `docs/design-docs/cesr-parser/CESR_PARSER_RECONCILIATION_MATRIX_2026-03-01.md`
- `docs/design-docs/cesr-parser/CESR_PARSER_CROSS_IMPL_COMPARISON_2026-03-01.md`
- `docs/design-docs/cesr-parser/CESR_PARSER_COMPLETENESS_DECISION_2026-03-01.md`

29. Cross-implementation comparison confirms no open `S0/S1` mismatch against
    KERIpy baseline; divergences in
    KERIox/libkeri/cesrixir/cesride/CESRox/kerits/keride are classified
    advisory.
30. Parser completeness gate decision is `GO`; medium/low P2 vectors
    (`V-P2-003`, `004`, `006`, `007`, `009`, `010`, `013`, `016`, `020`, `021`)
    are now implemented and regression-locked.

## New Thread Kickoff Template

```text
Use AGENTS.md startup protocol.
Read PROJECT_LEARNINGS.md and relevant topic learnings docs.
Summarize current state in 10 bullets.
Then do task: <TASK>.
```

## End-of-Task Handoff Template

```text
### YYYY-MM-DD - <Task Title>
- Topic docs updated:
  - <topic file path(s)>
- What changed:
  - ...
- Why:
  - ...
- Tests:
  - Command: ...
  - Result: ...
- Contracts/plans touched:
  - ...
- Risks/TODO:
  - ...
```
