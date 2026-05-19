# CESR Parser Readability Phased Roadmap

## Status

- Created: 2026-02-27
- Archived as historical reference: 2026-04-09
- Outcome: phases materially landed; this roadmap now exists only to preserve
  the sequencing logic

## Objective

Stage parser readability work in small, behavior-safe phases so maintainers
could improve structure without losing parity.

## Phase Summary

### Phase 0 - Baseline And Evidence Capture

- Locked current behavior with parity-oriented tests and edge-case vectors.
- Produced the initial behavior-lock/parity matrix and backlog split.

### Phase 1 - State Clarity And Documentation

- Clarified lifecycle terms and parser/frame state semantics.
- Improved docs/comments without intended behavior change.

### Phase 2 - Structural Decomposition

- Broke the parser into smaller collaborators and clearer boundaries.
- Preserved external behavior while making control flow reviewable.

### Phase 3 - Policy Extraction And Recovery Semantics

- Replaced opaque boolean policy branching with explicit policy seams.
- Made fallback/recovery behavior explicit and observable.

### Phase 4 - Typed Payloads And Dispatch Spec

- Migrated attachment payloads toward discriminated unions.
- Centralized dispatch metadata in one declarative source.

### Phase 5 - Minor-Version And Codex Rectification

- Replaced ad hoc major-version branching with version-aware registries.
- Closed codex/table parity gaps discovered during implementation.

### Phase 6 - Hardening And Deferred Perf Hand-Off

- Completed the readability-safe hardening pass.
- Kept performance work deferred behind the clearer architecture.

## Durable Lessons

1. Readability refactors need parity locks first.
2. Policy seams are safer than expanding conditionals.
3. Version/codex lookup should be registry-driven, not scattered branching.
4. Typed payloads and explicit recovery diagnostics make the parser easier to
   reason about than opaque collections and hidden fallbacks.
5. Once the readability goals are met, active authority should move to the
   normative contract and current learnings docs rather than this roadmap.
