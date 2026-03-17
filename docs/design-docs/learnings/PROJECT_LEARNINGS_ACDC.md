# PROJECT_LEARNINGS_ACDC

## Purpose

Persistent learnings for ACDC modeling, issuance/exchange behavior, and
credential interoperability.

## Current Status

### 2026-02-28

1. No dedicated ACDC deep-dive updates captured yet in this cycle.
2. Keep this file for ACDC-specific architecture and implementation memory.

### 2026-03-17

1. `SerderACDC` compactification parity now depends on section-label-aware
   normalization: schema sections compute `$id`, ordinary saidive sections
   compute `d`, and aggregate sections compute/verify `agid`.
2. Compactable top-level ACDCs and partial section-message ilks are different
   verification lanes: compactive ilks hash over the most compact section form,
   while partial section messages keep visible sections expanded but still
   require embedded identifiers to be correct.
3. Native ACDC support now runs through the shared native support matrix in
   `packages/cesr/src/serder/native.ts`, so map/fixed body shape, field-family
   semantics, and empty/non-empty rules are centralized instead of spread
   across parser and serder code.

## Scope Checklist

Use this doc for:

1. credential data model and serialization assumptions,
2. issuance/presentation exchange behavior,
3. validation and trust-chain constraints,
4. ACDC parity/interop findings.

## Cross-Topic Design References

1. DB architecture and parity contract (required context for credential indexing
   and storage-shape decisions that depend on duplicate ordering semantics):
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
  - Revisit ACDC-specific DB mappings against this design once D2/D3 parity work
    lands.

### 2026-03-17 - Section `$id` / `d` / `agid` Parity Became Explicit

- Topic docs updated:
  - `docs/design-docs/PROJECT_LEARNINGS.md`
  - `docs/design-docs/learnings/PROJECT_LEARNINGS_CESR.md`
- What changed:
  - `SerderACDC` now normalizes and verifies section identifiers using the same
    section-family split KERIpy uses:
    schema uses `$id`, normal section maps use `d`, and aggregate lists use
    `agid`.
  - ACDC native handling now shares the same matrix-driven support layer as the
    broader CESR-native serder path.
- Why:
  - The old implementation was still too generic and let compactable ACDC
    semantics drift behind "map in, map out" behavior.
- Tests:
  - Command:
    `deno test -A packages/cesr/test/unit/serder-native.test.ts packages/cesr/test/unit/serder-classes.test.ts packages/cesr/test/unit/serder-serialize.test.ts packages/cesr/test/unit/external-fixtures.test.ts packages/cesr/test/unit/parser.test.ts packages/cesr/test/hardening/parser-native-body-breadth.test.ts`
  - Result: passing
- Contracts/plans touched:
  - `packages/cesr/src/serder/native.ts`
  - `packages/cesr/src/serder/serder.ts`
- Risks/TODO:
  - Keep growing ACDC-native test coverage only through the shared native
    matrix; do not reintroduce section-specific sidecar parsers/emitters.
