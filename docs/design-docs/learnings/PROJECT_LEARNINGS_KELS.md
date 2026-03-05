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

## Cross-Topic Design References

1. DB architecture and parity contract (normative for DB/index ordering
   semantics used by KEL state and escrow paths):
   - `docs/design-docs/db/db-architecture.md`

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
  - Added parity gates for `list`/`aid` visibility checks, `ends add`, OOBI
    generate/resolve, direct+mailbox transport interop, and challenge
    generate/respond/verify.
  - Prioritized phase ordering so early work lands a two-controller usable
    interop baseline before broader feature domains (rotation/witness/multisig/
    ACDC/IPEX).
  - Preserved explicit path policy: default `.tufa` isolation plus opt-in KLI
    compatibility mode (`.keri`) via CLI/config.
- Why:
  - Move from narrow parity toward a practical interop harness that can validate
    meaningful controller-to-controller workflows and de-risk later KEL/comms
    features.
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
  - Seeded current-state statuses (`Partial` for currently present `LMDBer`, key
    helpers, `Baser`, and existing Keeper/Baser key slices) and left remaining
    inventory rows `Missing` by default.
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
  - Gate A-G classification currently uses a heuristic (`P1/Partial`) and should
    be refined to explicit per-gate mapping before status promotions.

### 2026-03-02 - Gate A-G Worklist Explicit Gate Mapping Added

- Topic docs updated:
  - `docs/plans/keri/DB_LAYER_KV_GATE_AG_WORKLIST.csv`
  - `docs/plans/keri/DB_LAYER_PARITY_MATRIX.md`
  - `docs/plans/keri/DB_LAYER_RECONCILIATION_PLAN.md`
- What changed:
  - Added explicit per-row gate mapping in the Gate A-G K/V worklist via new
    columns: `gate` and `gate_rationale`.
  - Mapped all current Gate A-G rows to concrete gate sets (e.g. `A|B|C`, `A|E`,
    `A|F|G`) with rationale text describing why each K/V row belongs.
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

### 2026-03-02 - P0 Closure + Initial P1 DB Core Slice

- Topic docs updated:
  - `docs/plans/keri/KLI_TUFA_COMMAND_PARITY_MATRIX.md`
  - `docs/plans/keri/INIT_INCEPT_RECONCILIATION_PLAN.md`
  - `docs/plans/keri/DB_LAYER_RECONCILIATION_PLAN.md`
  - `docs/plans/keri/DB_LAYER_PARITY_MATRIX.md`
- What changed:
  - Added explicit Gate A-G command/output parity matrix for KLI vs tufa.
  - Added a matrix-driven Gate A-G interop harness scaffold with executable
    parity checks for current `init/incept/export` coverage and pending vectors
    for `list/aid/ends/oobi/challenge` surfaces.
  - Started P1 `dbing.py` parity by implementing missing core symbols:
    `splitOnKey`, `openLMDB`, and `clearDatabaserDir`.
  - Updated D0 parity matrix statuses for these symbols from `Missing` to
    `Partial` with direct test evidence references.
- Why:
  - P0 was still incomplete after DB matrix upgrades; harness and command-output
    parity tracking were missing.
  - Starting with low-risk `dbing.py` helper parity provides immediate progress
    into P1 without cross-module churn.
- Tests:
  - Command:
    `deno test --allow-all --unstable-ffi test/unit/db/core/keys.test.ts test/unit/db/core/lmdber-helpers.test.ts`
  - Result: `5 passed, 0 failed`
  - Command:
    `deno test --allow-all --unstable-ffi test/integration/app/interop-gates-harness.test.ts`
  - Result: `2 passed, 0 failed`
- Contracts/plans touched:
  - `docs/plans/keri/INIT_INCEPT_RECONCILIATION_PLAN.md`
  - `docs/plans/keri/DB_LAYER_RECONCILIATION_PLAN.md`
  - `docs/plans/keri/DB_LAYER_PARITY_MATRIX.md`
- Risks/TODO:
  - Harness has pending scenarios for blocked command surfaces and currently
    executes one ready parity flow.
  - P1 still needs broader LMDB lifecycle/iterator/dup semantics parity and
    migration/version behavior validation beyond helper-symbol closure.

### 2026-03-03 - DB Reconciliation Checkpoint (P0/D0 Confirmed, D1 Advanced)

- Topic docs updated:
  - `docs/plans/keri/DB_LAYER_RECONCILIATION_PLAN.md`
  - `docs/plans/keri/DB_LAYER_PARITY_MATRIX.md`
- What changed:
  - Revalidated Phase 2 sequencing and marked P0/D0 as complete for their stated
    exit criteria, with D1 as the active workstream.
  - Implemented additional `dbing.py` core parity in `LMDBer`: `cntTop`,
    `cntAll`, and `delTop`.
  - Tightened lifecycle parity by stamping `__version__` metadata on temp/new
    writeable DB opens in `LMDBer.reopen`, matching KERIpy temp/new DB intent.
  - Added db-core parity tests for lifecycle reopen/version and branch
    count/iteration/delete semantics in both non-dup and dupsort sub-databases.
- Why:
  - Move from D1 helper-only progress to concrete core branch/lifecycle parity
    needed before Suber/Komer migration work.
- Tests:
  - Command:
    `deno test --allow-all --unstable-ffi test/unit/db/core/keys.test.ts test/unit/db/core/lmdber-helpers.test.ts test/unit/db/core/lmdber-core-parity.test.ts`
  - Result: `8 passed, 0 failed`
- Contracts/plans touched:
  - `docs/plans/keri/DB_LAYER_RECONCILIATION_PLAN.md`
  - `docs/plans/keri/DB_LAYER_PARITY_MATRIX.md`
- Risks/TODO:
  - `LMDBer` remains `Partial` because broader `dbing.py` surface (ordinal,
    dupset/io-dup helpers, and migration breadth) still needs parity closure in
    subsequent D1 slices.

### 2026-03-03 - LMDB `dupsort` Design Doc Published

- Topic docs updated:
  - `docs/design-docs/db/db-architecture.md`
- What changed:
  - Added a dedicated DB design doc documenting KERIpy `dupsort=True` semantics
    and required `keri-ts` parity behavior for `Dup`/`IoDup`/`IoSet`/`On*` class
    families.
  - Linked this learnings file to the design doc as a cross-topic reference for
    KEL workstreams.
- Why:
  - KEL indexing and escrow state rely on correct duplicate ordering and
    idempotence semantics; this centralizes the design contract for future work.
- Tests:
  - Command: N/A (design documentation update only)
  - Result: N/A
- Contracts/plans touched:
  - `docs/design-docs/db/db-architecture.md`
- Risks/TODO:
  - Keep the design doc synchronized with future D1/D2 parity implementation
    decisions and test evidence.

### 2026-03-03 - DB Architecture Contract Rewrite + Invariants Added

- Topic docs updated:
  - `docs/design-docs/db/db-architecture.md`
- What changed:
  - Rewrote the doc from a dupsort-focused note into a broader DB architecture
    contract covering KERIpy vs `keri-ts` layering, storage models, and
    implementation policy.
  - Added a normative `DB Invariants Contract` section with ordering,
    idempotence, serialization, keyspace, lifecycle, and interop invariants.
- Why:
  - Make DB-level design decisions and parity constraints easier to reason about
    across KEL features than a single-feature dupsort narrative.
- Tests:
  - Command: N/A (design documentation update only)
  - Result: N/A
- Contracts/plans touched:
  - `docs/design-docs/db/db-architecture.md`
- Risks/TODO:
  - Keep invariant clauses aligned with future D1-D7 parity evidence and any
    documented KERIpy divergence decisions.

### 2026-03-03 - D1 `LMDBer` Core Family Parity Expansion

- Topic docs updated:
  - `docs/plans/keri/DB_LAYER_RECONCILIATION_PLAN.md`
  - `docs/plans/keri/DB_LAYER_PARITY_MATRIX.md`
- What changed:
  - Expanded `keri-ts` `LMDBer` to cover the broader `dbing.py` core method
    families required for downstream Suber migration: `On*`/`OnAll*`,
    `IoSet*`/`OnIoSet*`, `dup*`, `IoDup*`, and `OnIoDup*` APIs.
  - Added new parity unit coverage for ordinal-key semantics, io-set semantics,
    and dup/io-dup semantics in addition to prior lifecycle/branch coverage.
- Why:
  - D2 Suber migration requires these DB-core primitives; they are part of D1
    scope and not deferred to later phases.
- Tests:
  - Command:
    `deno test --allow-all --unstable-ffi packages/keri/test/unit/db/core/keys.test.ts packages/keri/test/unit/db/core/lmdber-helpers.test.ts packages/keri/test/unit/db/core/lmdber-core-parity.test.ts`
  - Result: `11 passed, 0 failed`
- Contracts/plans touched:
  - `docs/plans/keri/DB_LAYER_RECONCILIATION_PLAN.md`
  - `docs/plans/keri/DB_LAYER_PARITY_MATRIX.md`
- Risks/TODO:
  - `LMDBer` remains `Partial` pending deeper edge-case parity sweeps and
    evidence expansion against KERIpy behavior under mixed-key and backward-iter
    corner cases.

### 2026-03-03 - D1 Oracle Pass (Backward Iterators + Mixed-Key Edges)

- Topic docs updated:
  - `docs/plans/keri/DB_LAYER_RECONCILIATION_PLAN.md`
  - `docs/plans/keri/DB_LAYER_PARITY_MATRIX.md`
- What changed:
  - Added strict KERIpy-oracle vectors for tricky backward/mixed-key behavior in
    `OnIoSet` and `OnIoDup` iterator families.
  - Added a unit-test representation sweep to ensure every current `LMDBer`
    method has at least one direct unit-test call site.
  - Added direct unit coverage for `createLMDBer` factory alias.
- Why:
  - Remove ambiguity before manual reconciliation review and make D1 method
    surface auditable at function level.
- Tests:
  - Command:
    `deno test --allow-all --unstable-ffi packages/keri/test/unit/db/core/keys.test.ts packages/keri/test/unit/db/core/lmdber-helpers.test.ts packages/keri/test/unit/db/core/lmdber-core-parity.test.ts`
  - Result: `14 passed, 0 failed`
  - Coverage check (method-name scan): `81` LMDBer methods, `0` missing from
    test references.
- Contracts/plans touched:
  - `docs/plans/keri/DB_LAYER_RECONCILIATION_PLAN.md`
  - `docs/plans/keri/DB_LAYER_PARITY_MATRIX.md`
- Risks/TODO:
  - Representation coverage is now complete, but behavioral equivalence still
    needs continued method-by-method oracle vectors for non-tricky families as
    D1 closes.

### 2026-03-03 - LMDBer Helper/Test Doc Pass

- Topic docs updated:
  - `packages/keri/src/db/core/lmdber.ts`
  - `packages/keri/test/unit/db/core/lmdber-core-parity.test.ts`
  - `packages/keri/test/unit/db/core/lmdber-helpers.test.ts`
- What changed:
  - Added concise maintainer-oriented docs to the top `LMDBer` helper layer
    (`toBytes`, byte dedupe helpers, and IoDup proem helpers), including short
    examples where practical.
  - Added concise intent comments in coverage/oracle unit tests to make parity
    scope and oracle provenance explicit for manual review.
- Why:
  - Improve readability for method-by-method reconciliation and reduce context
    loss while reviewing parity logic.
- Tests:
  - Command:
    `deno test --allow-all --unstable-ffi packages/keri/test/unit/db/core/keys.test.ts packages/keri/test/unit/db/core/lmdber-helpers.test.ts packages/keri/test/unit/db/core/lmdber-core-parity.test.ts`
  - Result: `14 passed, 0 failed`
- Contracts/plans touched:
  - N/A (documentation/readability update only)
- Risks/TODO:
  - Continue keeping helper/test docs synchronized as D1 edge-case vectors
    expand.

### 2026-03-03 - Post-Gate Review Flag for `cntTop`/`cntAll`

- Topic docs updated:
  - `packages/keri/src/db/core/lmdber.ts`
  - `docs/plans/keri/DB_LAYER_RECONCILIATION_PLAN.md`
  - `docs/plans/keri/DB_LAYER_PARITY_MATRIX.md`
- What changed:
  - Added explicit review flags in code/docs to re-evaluate `LMDBer.cntTop` and
    `LMDBer.cntAll` after `kli init/incept/rotate` implementation.
- Why:
  - Keep API surface lean unless usage or clarity benefits justify sugar APIs.
- Tests:
  - Command: N/A (tracking note only)
  - Result: N/A
- Contracts/plans touched:
  - `docs/plans/keri/DB_LAYER_RECONCILIATION_PLAN.md`
  - `docs/plans/keri/DB_LAYER_PARITY_MATRIX.md`
- Risks/TODO:
  - Execute this review once `init/incept/rotate` DB call graph is stable.
