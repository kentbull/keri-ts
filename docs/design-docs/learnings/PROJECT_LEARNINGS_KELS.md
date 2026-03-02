# PROJECT_LEARNINGS_KELS

## Purpose

Persistent learnings for KEL processing, event-state transitions, and
replay/verification semantics.

## Current Status

### 2026-02-28

1. No dedicated KEL-focused updates captured yet in this cycle.
2. Keep this file as the canonical memory location for KEL workstreams.

## Scope Checklist

Use this doc for:

1. event validation and ordering rules,
2. replay behavior and state derivation,
3. key state transition constraints,
4. compatibility nuances with KERIpy KEL behavior.

## Planned Sections

1. Decision log
2. Behavioral invariants
3. Test corpus and parity vectors
4. Risks and TODOs

## Handoff Log

### 2026-03-02 - Init/Incept + Comms Reconciliation Plan Expansion

- Topic docs updated:
  - `docs/plans/keri/INIT_INCEPT_RECONCILIATION_PLAN.md`
- What changed:
  - Expanded the reconciliation scope from init/incept-only to a usable
    bootstrap arc aligned with KERIpy `scripts/demo/basic/challenge.sh`.
  - Added parity gates for `list`/`aid` visibility checks, `ends add`,
    OOBI generate/resolve, direct+mailbox transport interop, and challenge
    generate/respond/verify.
  - Prioritized phase ordering so early work lands a two-controller usable
    interop baseline before broader feature domains (rotation/witness/multisig/
    ACDC/IPEX).
  - Preserved explicit path policy: default `.tufa` isolation plus opt-in KLI
    compatibility mode (`.keri`) via CLI/config.
- Why:
  - Move from narrow parity toward a practical interop harness that can
    validate meaningful controller-to-controller workflows and de-risk later
    KEL/comms features.
- Tests:
  - Command: N/A (planning/documentation update only)
  - Result: N/A
- Contracts/plans touched:
  - `docs/plans/keri/INIT_INCEPT_RECONCILIATION_PLAN.md`
- Risks/TODO:
  - Command-level parity details still require implementation-level validation
    against KERIpy behavior and output shape.

### 2026-03-02 - DB Layer Reconciliation Plan Added (Phase 2)

- Topic docs updated:
  - `docs/plans/keri/INIT_INCEPT_RECONCILIATION_PLAN.md`
  - `docs/plans/keri/DB_LAYER_RECONCILIATION_PLAN.md`
- What changed:
  - Tightened the parent init/incept reconciliation plan to explicitly require
    full LMDB parity before provider abstraction implementation.
  - Added a dedicated DB plan with ordered workstreams for `dbing.py`,
    `subing.py`, `koming.py`, `basing.py`, and `escrowing.py`.
  - Added parity-matrix/inventory-first execution using
    `docs/design-docs/db/lmdb-dumper.md` and explicit closure gates.
- Why:
  - Reduce translation drift between KERIpy and `keri-ts` by anchoring phase
    execution on DB-layer parity before architecture generalization.
- Tests:
  - Command: N/A (planning/documentation update only)
  - Result: N/A
- Contracts/plans touched:
  - `docs/plans/keri/INIT_INCEPT_RECONCILIATION_PLAN.md`
  - `docs/plans/keri/DB_LAYER_RECONCILIATION_PLAN.md`
- Risks/TODO:
  - Detailed per-function/per-class parity matrix rows still need to be filled
    during D0 execution.

### 2026-03-02 - D0 Parity Matrix Skeleton Generated

- Topic docs updated:
  - `docs/plans/keri/DB_LAYER_PARITY_MATRIX.md`
  - `docs/plans/keri/DB_LAYER_KV_PARITY_MATRIX.csv`
  - `docs/plans/keri/DB_LAYER_RECONCILIATION_PLAN.md`
- What changed:
  - Generated initial function/class parity matrix skeleton from KERIpy DB
    module symbols in `dbing.py`, `subing.py`, `koming.py`, `basing.py`, and
    `escrowing.py`.
  - Generated initial K/V parity inventory CSV from
    `docs/design-docs/db/lmdb-dumper.md` with domain, key, class, schemas,
    proposed TS target, phase, status, and priority columns.
  - Seeded current-state statuses (`Partial` for currently present `LMDBer`,
    key helpers, `Baser`, and existing Keeper/Baser key slices) and left
    remaining inventory rows `Missing` by default.
  - Linked these artifacts directly into the DB reconciliation plan D0 section
    as published skeleton deliverables.
- Why:
  - Create a concrete D0 execution baseline that can be incrementally promoted
    from inventory to parity-validated implementation evidence.
- Tests:
  - Command: `rg`/`awk`/`sed` extraction and file generation checks
  - Result: Artifacts generated with `67` module symbols and `130` K/V rows
    seeded.
- Contracts/plans touched:
  - `docs/plans/keri/DB_LAYER_RECONCILIATION_PLAN.md`
  - `docs/plans/keri/DB_LAYER_PARITY_MATRIX.md`
  - `docs/plans/keri/DB_LAYER_KV_PARITY_MATRIX.csv`
- Risks/TODO:
  - Symbol-level `Partial` rows still require explicit behavior parity tests
    before any status can be promoted to `Equivalent`.

### 2026-03-02 - D0 Inventory Matrix Upgraded (Owners + Gate Worklists)

- Topic docs updated:
  - `docs/plans/keri/DB_LAYER_PARITY_MATRIX.md`
  - `docs/plans/keri/DB_LAYER_KV_GATE_AG_WORKLIST.csv`
  - `docs/plans/keri/DB_LAYER_KV_GATE_H_BACKLOG.csv`
  - `docs/plans/keri/DB_LAYER_RECONCILIATION_PLAN.md`
  - `docs/plans/keri/INIT_INCEPT_RECONCILIATION_PLAN.md`
- What changed:
  - Upgraded the D0 parity matrix from skeleton to a usable workbook with owner
    lanes (`DB-CORE`, `DB-SUBER`, `DB-KOMER`, `DB-BASER`, `DB-ESCROW`) and
    concrete proposed `keri-ts` file/symbol targets per KERIpy symbol row.
  - Added D0 snapshot counts for symbol statuses and K/V worklist sizes.
  - Split K/V parity matrix into two actionable lists:
    - Gate A-G worklist: current rows with `priority=P1` or `status=Partial`
    - Gate H backlog: remaining rows
- Why:
  - Move D0 from inventory capture to execution-ready backlog segmentation so
    work can proceed in gate order without losing full-parity traceability.
- Tests:
  - Command: generation/validation via `rg` + `sed` + `awk` + file checks
  - Result: 67 symbol rows maintained; K/V split = 33 Gate A-G, 97 Gate H
- Contracts/plans touched:
  - `docs/plans/keri/DB_LAYER_PARITY_MATRIX.md`
  - `docs/plans/keri/DB_LAYER_RECONCILIATION_PLAN.md`
  - `docs/plans/keri/INIT_INCEPT_RECONCILIATION_PLAN.md`
- Risks/TODO:
  - Gate A-G classification currently uses a heuristic (`P1/Partial`) and
    should be refined to explicit per-gate mapping before status promotions.

### 2026-03-02 - Gate A-G Worklist Explicit Gate Mapping Added

- Topic docs updated:
  - `docs/plans/keri/DB_LAYER_KV_GATE_AG_WORKLIST.csv`
  - `docs/plans/keri/DB_LAYER_PARITY_MATRIX.md`
  - `docs/plans/keri/DB_LAYER_RECONCILIATION_PLAN.md`
- What changed:
  - Added explicit per-row gate mapping in the Gate A-G K/V worklist via new
    columns: `gate` and `gate_rationale`.
  - Mapped all current Gate A-G rows to concrete gate sets (e.g. `A|B|C`,
    `A|E`, `A|F|G`) with rationale text describing why each K/V row belongs.
  - Updated matrix/reconciliation docs to describe this as explicit mapping,
    replacing prior heuristic wording in the matrix artifact notes.
- Why:
  - Make Gate A-G execution auditable at key granularity and avoid ambiguous
    priority-driven grouping when validating feature readiness by gate.
- Tests:
  - Command: deterministic mapping pass over Gate A-G CSV with zero-unmatched
    row check
  - Result: `33` rows mapped, `0` unmatched
- Contracts/plans touched:
  - `docs/plans/keri/DB_LAYER_PARITY_MATRIX.md`
  - `docs/plans/keri/DB_LAYER_RECONCILIATION_PLAN.md`
- Risks/TODO:
  - Some rows span multiple gates by design; if needed, add a future
    `primary_gate` column to simplify burn-down sequencing.
