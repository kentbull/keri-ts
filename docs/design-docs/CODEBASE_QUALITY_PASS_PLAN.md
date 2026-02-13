# keri-ts Code Quality Pass Plan

## Objective

Raise maintainability, readability, library consumability, and long-term
evolvability across `keri-ts` (app, db, CESR) without destabilizing behavior.

## Quality Principles

- Prefer small, labeled functions and explicit composition over large
  mixed-responsibility methods.
- Keep domain behavior strict by default; add recovery only at intentional
  compatibility boundaries.
- Make library API surfaces explicit and stable (public vs internal boundaries).
- Standardize cross-cutting concerns: error model, logging, config, and test
  strategy.
- Improve incrementally with test-gated, low-risk batches.

## Scope

- In-scope: `src/**`, `packages/cesr/src/**`, supporting scripts and docs.
- Out-of-scope (for this pass): full event-processing feature completion,
  protocol expansion beyond current implemented behavior.

## Baseline Snapshot (from current code)

- Repo scale: ~`7,254` TS code lines (whole repo TS), ~`4,258` TS code lines in
  core CESR package.
- Highest complexity/size hotspots:
  - `packages/cesr/src/core/parser-engine.ts`
  - `packages/cesr/src/parser/group-dispatch.ts`
  - `packages/cesr/src/annotate/render.ts`
  - `src/db/core/lmdber.ts`
  - `src/db/core/path-manager.ts`
  - `src/app/cli/cli.ts`
- Cross-cutting smells found:
  - Mixed concerns (I/O, domain logic, orchestration in same functions).
  - Inconsistent error typing (generic `Error` in many places).
  - Logging via direct `console.*` across core and infra code.
  - Repeated encode/decode allocations and key-construction duplication
    (`src/db/core/keys.ts`).
  - API layering ambiguity (legacy bridge exports under `src/cesr/**`, broad
    export surfaces).
  - Stubbed/placeholder CLI commands mixed into production command registry.

## Execution Strategy

Work in small, independently shippable phases. Each phase has clear acceptance
criteria and test gates.

### Phase 0: Guardrails + Baseline (no behavior change)

- Deliverables:
  - Add architecture map doc (`module boundaries`, `public APIs`,
    `internal-only modules`).
  - Add quality gates in `deno task` workflow: format + tests + type check.
  - Add lightweight static debt report command (TODOs, console usage, complexity
    hot files).
- Acceptance criteria:
  - One-command quality gate runnable locally.
  - Baseline metrics captured in docs.

### Phase 1: Error Model Unification

- Focus:
  - Introduce typed error families for app/db layers similar to CESR parser
    errors.
  - Replace repeated `throw new Error(...)` with domain-specific errors where
    useful.
  - Standardize catch behavior: either typed recovery or rethrow.
- Target files:
  - `src/db/core/lmdber.ts`, `src/db/core/path-manager.ts`, `src/db/basing.ts`,
    CLI error paths.
- Acceptance criteria:
  - Core/db operations throw typed errors with context.
  - No broad silent recovery points without comment and rationale.

### Phase 2: Logging + Diagnostics Strategy

- Focus:
  - Introduce logger interface (`debug/info/warn/error`) with default console
    adapter.
  - Remove direct `console.*` from core library code (keep CLI presentation
    layer output).
  - Add correlation/context fields where appropriate (path, db name, counter
    code, etc.).
- Target files:
  - `src/db/**`, `src/app/server.ts`, `src/app/cli/*`, selected CESR entry
    points.
- Acceptance criteria:
  - Core modules depend on logger abstraction, not direct console.
  - CLI controls verbosity and formatting.

### Phase 3: DB Layer Architecture Cleanup

- Focus:
  - Clarify and consolidate DB APIs (`src/db/core/db.ts` singleton helper vs
    `LMDBer/Baser`).
  - Separate path policy from side-effectful filesystem operations in
    `PathManager`.
  - Extract small helpers for repeated LMDB open/check/retry behavior.
- Target files:
  - `src/db/core/path-manager.ts`, `src/db/core/lmdber.ts`, `src/db/core/db.ts`,
    `src/db/basing.ts`.
- Acceptance criteria:
  - Single canonical DB access path for app/server usage.
  - PathManager responsibilities split into computation vs I/O execution.

### Phase 4: CLI Composition + Command Architecture

- Focus:
  - Split command declaration from command execution wiring in `cli.ts`.
  - Move each command to isolated module with validated argument schema.
  - Keep stubs explicit and gated behind feature flags or separate command
    group.
- Target files:
  - `src/app/cli/cli.ts`, `src/app/cli/init.ts`, `src/app/cli/agent.ts`,
    `src/app/cli/db-dump.ts`.
- Acceptance criteria:
  - `cli.ts` becomes a thin composition root.
  - Commands are individually testable without shared mutable context.

### Phase 5: CESR API Surface + Internal Layering

- Focus:
  - Define stable public CESR API (`packages/cesr/src/index.ts`) vs
    internal-only modules.
  - Reduce accidental exports of low-level internals where possible.
  - Ensure adapter/story for both library and CLI consumption is explicit.
- Target files:
  - `packages/cesr/src/index.ts`, `src/cesr/**` bridge modules, docs.
- Acceptance criteria:
  - Clear public API contract documented.
  - Internal modules not required by consumers for normal use.

### Phase 6: Hotspot Refactors (Small Functions + Composition)

- Focus:
  - Continue decomposition in highest complexity files while preserving
    behavior.
  - Extract reusable parse/building blocks where duplication remains.
  - Improve naming for intent and domain semantics.
- Target files:
  - `packages/cesr/src/core/parser-engine.ts`
  - `packages/cesr/src/parser/group-dispatch.ts`
  - `src/db/core/lmdber.ts`
  - `src/db/core/path-manager.ts`
- Acceptance criteria:
  - Lower per-file cognitive load (smaller functions, clearer sectioning).
  - No parser regressions (all CESR tests green).

### Phase 7: Performance + Allocation Hygiene

- Focus:
  - Deduplicate repeated `TextEncoder/TextDecoder` construction.
  - Reduce avoidable array/string conversions in key/path/parser helpers.
  - Add micro-bench or low-overhead perf checks for parser hot paths.
- Target files:
  - `src/db/core/keys.ts`, `src/core/bytes.ts`, parser primitives.
- Acceptance criteria:
  - Measurable reduction in obvious allocation churn in hot paths.

### Phase 8: Documentation + Developer Experience Closeout

- Focus:
  - Add concise maintainer docs for app/db subsystems (like CESR maintainer
    guide).
  - Add architecture decision records for key tradeoffs (Effection integration,
    fallback behavior).
  - Update README with accurate current capability boundaries.
- Acceptance criteria:
  - New contributors can locate boundaries, extension points, and invariants
    quickly.

## Incremental Work Package Template

For each phase, execute in this pattern:

1. Baseline tests + capture current behavior.
2. Refactor in small commits by sub-area.
3. Add/adjust tests alongside refactor.
4. Run quality gate (`fmt`, targeted tests, full tests before merge).
5. Update docs/changelog notes.

## Definition of Done (per phase)

- Behavior-preserving unless explicitly marked otherwise.
- Tests pass (`deno task test`, `deno task test:cesr` as relevant).
- No new untyped recovery points.
- Added or updated docs for any changed boundary or extension point.
- Complexity reduced or readability improved in targeted files.

## Proposed Order of Attack

1. Phase 0 (guardrails)
2. Phase 1 + 2 (error/logging foundation)
3. Phase 3 (DB architecture)
4. Phase 4 (CLI composition)
5. Phase 5 + 6 (CESR API and hotspot refinements)
6. Phase 7 + 8 (perf + docs closeout)

This order minimizes risk by fixing cross-cutting foundations before deeper
structural refactors.
