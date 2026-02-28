# CESR Parser P2 Hardening and Interop Plan

## Status

- Created: 2026-02-28
- Priority: medium (post P0/P1 parity closure, pre broad ecosystem rollout)
- Source backlog: extracted from `docs/plans/cesr-parser-phase0-behavior-lock-parity-matrix.md` PARTIAL rows

## Goal

Track breadth-oriented parser hardening and interop vectors separately from P0/P1 parity lock so:

- P0/P1 remains a strict behavior-closure baseline
- P2 can focus on scale, breadth, and long-tail compatibility evidence

## Relationship to Existing Plans

- Readability plan: `docs/plans/cesr-parser-readability-improvement-plan.md`
- Phased roadmap: `docs/plans/cesr-parser-readability-phased-roadmap.md`
- P0/P1 matrix: `docs/plans/cesr-parser-phase0-behavior-lock-parity-matrix.md`

This document is the dedicated backlog for deferred breadth and hardening vectors.

## Scope

In scope:

- breadth variants of already-locked P0/P1 behaviors
- deep nesting, mixed-domain, and large-count stress cases
- explicit KERIpy interop corpus checks for edge formats
- robustness against malformed but realistic hostile streams

Out of scope:

- parser feature redesign
- perf-first parser architecture changes (tracked separately)

## P2 Hardening Vector Backlog

Priority legend:

- `H` high-value hardening before broad production use
- `M` medium-value interop breadth
- `L` long-tail robustness/fuzzing depth

### A) Wrapper and Group Breadth

1. `V-P2-001` (`H`) Big-count `BodyWithAttachmentGroup` with large opaque payload in both `txt` and `bny`.
2. `V-P2-002` (`H`) Deep nested `GenericGroup` chain (4-6 levels) with mixed child wrapper types.
3. `V-P2-003` (`M`) Mixed short and big wrapper counters in one top-level stream (`-A`, `--A`, `-B`, `--B`, `-C`, `--C`).
4. `V-P2-004` (`M`) Wrapper payload ending exactly on boundary followed by immediate next wrapper start across chunk splits.

### B) Native Body (Fix/Map) Breadth

5. `V-P2-005` (`H`) `FixBodyGroup` with maximal supported primitive sequence for each mapped field category.
6. `V-P2-006` (`M`) `MapBodyGroup` with multiple label/value pairs and nested matter primitives across chunk boundaries.
7. `V-P2-007` (`M`) Annotated CESR round-trip for native bodies with all currently supported primitive labels.

### C) Version Context and Selector Stress

8. `V-P2-008` (`H`) Multiple `KERIACDCGenusVersion` selectors in nested wrappers with alternating major versions.
9. `V-P2-009` (`M`) Legacy implicit-v1 outer frame followed by explicit selector wrapper in same stream.
10. `V-P2-010` (`M`) Selector present but irrelevant to subsequent non-wrapper token sequence (no accidental context bleed).

### D) Mixed Stream Interop Breadth

11. `V-P2-011` (`H`) Long mixed stream: JSON Serder frame + MGPK frame + CBOR frame + native frame + wrapper frame.
12. `V-P2-012` (`H`) Same semantic corpus encoded as qb64 and qb2, asserting equivalent frame summaries and metadata.
13. `V-P2-013` (`M`) Interleaved annotation bytes (`ano`) between heterogeneous frame domains and wrapper styles.

### E) Error and Recovery Hardening

14. `V-P2-014` (`H`) Large declared counts with early EOF (shortage then flush) ensuring no duplicate emissions and stable remainder.
15. `V-P2-015` (`H`) Malformed wrapper header followed by valid frame: strict mode fail-fast, compat mode recovery contract.
16. `V-P2-016` (`M`) Repeated `flush()` calls after error + reset + clean feed in multi-frame stream (idempotent lifecycle check).

### F) Cross-Implementation Evidence Pack

17. `V-P2-017` (`H`) Golden corpus generated from KERIpy fixtures (`txt`/`bny`) with expected frame/attachment summaries.
18. `V-P2-018` (`M`) Codex drift sentinel: assert keri-ts dispatch tables remain aligned with selected KERIpy codex entries.
19. `V-P2-019` (`L`) Historical v1 deployment samples without context selectors (JSON-first assumptions) in compatibility mode.

### G) Fuzz and Boundary Exhaustiveness

20. `V-P2-020` (`M`) N-way split fuzzing (3-8 split points) on wrapper-heavy streams with deterministic summary assertion.
21. `V-P2-021` (`L`) Mutation fuzz on counters, counts, and selector payloads with crash-safety and bounded error classes.

### H) Performance Testing

22. Large-payload soak tests (latency/memory bounds) under atomic bounded parsing.
- Why: validates operational safety envelope and documents expected performance profile.

## Suggested Test Organization

- `packages/cesr/test/hardening/parser-wrapper-breadth.test.ts` (`V-P2-001`..`004`)
- `packages/cesr/test/hardening/parser-native-body-breadth.test.ts` (`V-P2-005`..`007`)
- `packages/cesr/test/hardening/parser-version-context-hardening.test.ts` (`V-P2-008`..`010`)
- `packages/cesr/test/hardening/parser-mixed-interop-hardening.test.ts` (`V-P2-011`..`013`)
- `packages/cesr/test/hardening/parser-recovery-hardening.test.ts` (`V-P2-014`..`016`)
- `packages/cesr/test/hardening/parser-keripy-golden-corpus.test.ts` (`V-P2-017`..`019`)
- `packages/cesr/test/hardening/parser-fuzz-hardening.test.ts` (`V-P2-020`..`021`)

## Exit Criteria

- All `H` vectors pass in CI for default parser mode.
- At least one golden-corpus suite demonstrates stable parity summaries against KERIpy-derived fixtures.
- No unbounded parser-loop or duplicate-emission defects in fuzz and shortage hardening vectors.
