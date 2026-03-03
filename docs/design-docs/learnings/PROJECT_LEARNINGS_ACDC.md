# PROJECT_LEARNINGS_ACDC

## Purpose

Persistent learnings for ACDC modeling, issuance/exchange behavior, and
credential interoperability.

## Current Status

### 2026-02-28

1. No dedicated ACDC deep-dive updates captured yet in this cycle.
2. Keep this file for ACDC-specific architecture and implementation memory.

## Scope Checklist

Use this doc for:

1. credential data model and serialization assumptions,
2. issuance/presentation exchange behavior,
3. validation and trust-chain constraints,
4. ACDC parity/interop findings.

## Cross-Topic Design References

1. DB architecture and parity contract (required context for credential indexing and
   storage-shape decisions that depend on duplicate ordering semantics):
   - `docs/design-docs/db/db-architecture.md`

## Planned Sections

1. Decision log
2. Data-model invariants
3. Test vectors and fixtures
4. Risks and TODOs

## Handoff Log

### 2026-03-03 - LMDB `dupsort` Design Reference Added

- Topic docs updated:
  - `docs/design-docs/db/db-architecture.md`
- What changed:
  - Added a cross-topic reference to the DB architecture contract doc so ACDC
    task threads inherit the same KERIpy/`keri-ts` duplicate-index semantics
    model and invariants.
- Why:
  - ACDC storage and exchange flows often depend on DB indexing behavior; this
    avoids drift in duplicate ordering/idempotence assumptions.
- Tests:
  - Command: N/A (design documentation update only)
  - Result: N/A
- Contracts/plans touched:
  - `docs/design-docs/db/db-architecture.md`
- Risks/TODO:
  - Revisit ACDC-specific DB mappings against this design once D2/D3 parity
    work lands.
