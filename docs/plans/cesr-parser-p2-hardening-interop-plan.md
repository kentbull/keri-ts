# CESR Parser P2 Hardening and Interop Plan

## Status

- Created: 2026-02-28
- Updated: 2026-03-02
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

## Implementation Progress (2026-03-01)

Completed:

- `V-P2-001` in `packages/cesr/test/hardening/parser-p2-high-priority-hardening.test.ts`
  with big-count `BodyWithAttachmentGroup` txt/qb2 parity on large payload.
- `V-P2-002` in `packages/cesr/test/hardening/parser-p2-high-priority-hardening.test.ts`
  with deep nested `GenericGroup` chain split-determinism lock.
- `V-P2-005` in `packages/cesr/test/hardening/parser-p2-high-priority-hardening.test.ts`
  with fixed-body mapped primitive-category coverage lock using KERIpy fixture.
- `V-P2-008` in `packages/cesr/test/hardening/parser-p2-high-priority-hardening.test.ts`
  with alternating nested genus-version selector stress lock.
- `V-P2-011` in `packages/cesr/test/hardening/parser-p2-high-priority-hardening.test.ts`
  with long heterogeneous stream ordering lock (`JSON`/`MGPK`/`CBOR`/native/wrapper).
- `V-P2-012` in `packages/cesr/test/hardening/parser-p2-high-priority-hardening.test.ts`
  with wrapper-heavy corpus txt/qb2 semantic parity lock.
- `V-P2-014` in `packages/cesr/test/hardening/parser-p2-high-priority-hardening.test.ts`
  with large-count early-EOF flush/shortage idempotency lock.
- `V-P2-015` in `packages/cesr/test/hardening/parser-p2-high-priority-hardening.test.ts`
  with strict fail-fast vs compat recovery contract lock for malformed wrapper payload tails.
- `V-P2-017` in `packages/cesr/test/hardening/parser-keripy-golden-corpus.test.ts`
  with KERIpy-derived fixture corpus txt/qb2 parity and split-determinism assertions.
- `V-P2-018` in `packages/cesr/test/hardening/parser-keripy-golden-corpus.test.ts`
  with selected KERIpy codex/subset drift sentinel assertions.
- `V-P2-019` in `packages/cesr/test/hardening/parser-keripy-golden-corpus.test.ts`
  with historical implicit-v1 compatibility stream lock test.
- `V-P2-003` in `packages/cesr/test/hardening/parser-wrapper-breadth.test.ts`
  with mixed short/big wrapper counters (`-A/--A/-B/--B/-C/--C`) parity lock.
- `V-P2-004` in `packages/cesr/test/hardening/parser-wrapper-breadth.test.ts`
  with wrapper-boundary split determinism lock at immediate next-wrapper starts.
- `V-P2-006` in `packages/cesr/test/hardening/parser-native-body-breadth.test.ts`
  with multi-label nested `MapBodyGroup` boundary stability lock.
- `V-P2-007` in `packages/cesr/test/hardening/parser-native-body-breadth.test.ts`
  with annotate/denot native-body round-trip semantic stability lock.
- `V-P2-009` in `packages/cesr/test/hardening/parser-version-recovery-fuzz-hardening.test.ts`
  with implicit-v1 outer frame + explicit selector wrapper version-context lock.
- `V-P2-010` in `packages/cesr/test/hardening/parser-version-recovery-fuzz-hardening.test.ts`
  with selector non-bleed assertion for subsequent non-wrapper frames.
- `V-P2-013` in `packages/cesr/test/hardening/parser-version-recovery-fuzz-hardening.test.ts`
  with interleaved `ano` handling across heterogeneous frame domains.
- `V-P2-016` in `packages/cesr/test/hardening/parser-version-recovery-fuzz-hardening.test.ts`
  with post-error reset/flush idempotency lock in multi-frame flow.
- `V-P2-020` in `packages/cesr/test/hardening/parser-version-recovery-fuzz-hardening.test.ts`
  with deterministic 3-8 split-plan fuzz on wrapper-heavy streams.
- `V-P2-021` in `packages/cesr/test/hardening/parser-version-recovery-fuzz-hardening.test.ts`
  with deterministic mutation fuzz and bounded parser-error-class assertions.

Remaining:
- None.

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

- `packages/cesr/test/hardening/parser-p2-high-priority-hardening.test.ts` (`V-P2-001`, `002`, `005`, `008`, `011`, `012`, `014`, `015`)
- `packages/cesr/test/hardening/parser-wrapper-breadth.test.ts` (`V-P2-003`, `V-P2-004`)
- `packages/cesr/test/hardening/parser-native-body-breadth.test.ts` (`V-P2-006`, `V-P2-007`)
- `packages/cesr/test/hardening/parser-version-recovery-fuzz-hardening.test.ts` (`V-P2-009`, `010`, `013`, `016`, `020`, `021`)
- `packages/cesr/test/hardening/parser-keripy-golden-corpus.test.ts` (`V-P2-017`..`019`)

## Exit Criteria

- All `H` vectors pass in CI for default parser mode.
- At least one golden-corpus suite demonstrates stable parity summaries against KERIpy-derived fixtures.
- No unbounded parser-loop or duplicate-emission defects in fuzz and shortage hardening vectors.
- Full `M/L` vector set is lock-tested in-repo (`V-P2-003`, `004`, `006`, `007`, `009`, `010`, `013`, `016`, `020`, `021`).
