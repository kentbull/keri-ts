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
