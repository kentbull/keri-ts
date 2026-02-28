# PROJECT_LEARNINGS_CESR

## Purpose

Persistent CESR parser memory for `keri-ts`.

## Current State

### 2026-02-28

1. **Architecture direction**
- Atomic bounded-substream parser is intentional and documented.
- Incremental nested parser is deferred for a later perf-oriented module.

2. **Normative lifecycle contract**
- `docs/design-docs/CESR_PARSER_STATE_MACHINE_CONTRACT.md` is canonical.
- Contract is test-mapped and governs lifecycle behavior updates.

3. **Frame lifecycle model**
- `pendingFrame`: unresolved top-level frame continuation.
- `queuedFrames`: additional complete enclosed frames from `GenericGroup`.

4. **Ordering contract**
- Stream-order preservation is normative when pending and queued coexist.
- `flush()` now emits pending first, then queued.
- Covered by `V-P1-014`.

5. **GenericGroup behavior**
- Bounded payload parsing via `parseFrameSequence(...)`.
- First enclosed frame returns immediately; remainder queued.

6. **Version context model**
- Top-level stream scope (`streamVersion`).
- Frame attachment scope (`version`).
- Nested wrapper scope in dispatch parsing.
- Legacy implicit-v1 (no selector counters) is lock-tested.

7. **Dispatch behavior**
- `strict`: no major fallback.
- `compat`: fallback on unknown/deserialize errors with callback support.

8. **Flush semantics**
- Terminal remainder shortage emitted once.
- Repeated `flush()` is idempotent.

9. **Binary cold-start support**
- JSON, MGPK, and CBOR Serder cold-start tests pass.
- Uses external libraries for binary handling.

10. **Parity posture**
- P0 and P1 vectors complete and passing.
- P2 breadth/hardening tracked separately.

## Key Docs

1. `docs/design-docs/CESR_PARSER_STATE_MACHINE_CONTRACT.md`
2. `docs/design-docs/CESR_ATOMIC_BOUNDED_PARSER_ARCHITECTURE.md`
3. `docs/plans/cesr-parser-readability-improvement-plan.md`
4. `docs/plans/cesr-parser-readability-phased-roadmap.md`
5. `docs/plans/cesr-parser-phase0-behavior-lock-parity-matrix.md`
6. `docs/plans/cesr-parser-p2-hardening-interop-plan.md`
7. `docs/adr/adr-0001-parser-atomic-bounded-first.md`

## Current Follow-Ups

1. Begin Point 2 of ten-point plan (structural decomposition).
2. Keep lifecycle contract matrix synchronized with new tests/behavior.
3. Execute P2 hardening vectors prior to broad ecosystem rollout.

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
