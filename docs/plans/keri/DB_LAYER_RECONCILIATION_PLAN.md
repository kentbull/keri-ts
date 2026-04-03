# DB Layer Reconciliation Plan (KERIpy -> keri-ts)

## Context

This plan is a Phase 2 execution artifact under:

- `docs/plans/keri/INIT_INCEPT_RECONCILIATION_PLAN.md`

Phase 1 (CESR parser) is complete. Phase 2 prioritizes database parity and
usable interop. LMDB parity is completed first; provider abstraction
implementation follows parity closure.

## Objective

Deliver a KERIpy-equivalent LMDB database layer in `keri-ts` that supports:

1. Reliable feature-by-feature translation verification from KERIpy.
2. Stable `tufa init`/`tufa incept`/communication behavior.
3. A clean foundation for later pluggable storage providers.
4. Storage-facing semantics that stay isolated enough for later IndexedDB or
   other providers to preserve behavior without re-deriving LMDB assumptions
   from app-layer code.

## Execution Status (2026-04-03)

1. `D0` is complete and was re-audited on 2026-04-03:
   - the symbol matrix now reflects the current local KERIpy line numbers,
   - `recording.py` is now an explicit parity source instead of incorrectly
     attributing record-contract rows to `basing.py`,
   - the row inventory now covers 70 parity-relevant symbols with corrected
     `Partial`/`Missing`/`Equivalent` statuses.
2. `D1` remains substantially landed but not fully parity-closed:
   - `LMDBer` covers the required `dbing.py` method families used by downstream
     wrappers (`On*`, `OnAll*`, `IoSet*`, `OnIoSet*`, `dup*`, `IoDup*`, and
     `OnIoDup*`),
   - unit coverage spans lifecycle, branch helpers, ordinal-key semantics,
     io-set semantics, dup/io-dup semantics, and KERIpy oracle vectors for
     mixed-key reverse scans,
   - several helper rows remain intentionally `Partial` because the TS API shape
     still differs from KERIpy (`openLMDB` factory style, key-helper
     return-type differences, `splitKeyDT` string vs datetime behavior).
3. `D2` is much further along than the earlier bootstrap-only description:
   - all 30 inventoried `subing.py` class families now exist in
     `packages/keri/src/db/subing.ts`,
   - most rows remain `Partial` because direct row-specific parity evidence is
     still incomplete,
   - `CryptSignerSuber` is currently the only audited `Equivalent` row in the
     wrapper layer.
4. `D3` is also materially further along than the earlier bootstrap view:
   - `koming.ts` now includes `KomerBase`, `Komer`, and `IoSetKomer`,
   - JSON/CBOR/MGPK serializer selection is present at the `KomerBase` seam,
   - the only truly missing inventoried `koming.py` row is `DupKomer`.
5. `D4` now has a broad databaser/record-contract foundation in place:
   - `Baser` binds the large named-subdb surface used by the current runtime
     arc rather than only a narrow visibility slice,
   - persisted record contracts now live explicitly in
     `packages/keri/src/core/records.ts`,
   - KERIpy's `statedict` read-through behavior is approximated by explicit
     `reloadKevers()` / `getKever()` helpers instead of a Python dict subclass,
   - the true remaining missing D4 rows are `RawRecord`, `OobiQueryRecord`, and
     `BaserDoer`.
6. `D5` has not started in earnest:
   - `Broker` / `escrowing.ts` is still missing,
   - the main remaining blockers are now concentrated in record-helper closure,
     `DupKomer`, escrow/process-loop breadth, and the later K/V/Gate H surface
     rather than in the old Gate C encrypted-secret bootstrap work.

## Scope Sources (Parity Baseline)

Primary KERIpy references:

- `src/keri/db/dbing.py`
- `src/keri/db/subing.py`
- `src/keri/db/koming.py`
- `src/keri/recording.py`
- `src/keri/db/basing.py`
- `src/keri/db/escrowing.py`

Primary class families targeted:

- `LMDBer`
- `Baser`
- `Mailboxer`
- `Noter`
- `Reger`
- `Keeper`
- Suber variants (`Suber`, `CesrSuber`, `CatCesrSuber`, and related classes)
- Komer variants

K/V inventory reference:

- `docs/design-docs/db/lmdb-dumper.md`

Initial D0 artifacts (seeded):

- `docs/plans/keri/DB_LAYER_PARITY_MATRIX.md`
- `docs/plans/keri/DB_LAYER_KV_PARITY_MATRIX.csv`
- `docs/plans/keri/DB_LAYER_KV_GATE_AG_WORKLIST.csv`
- `docs/plans/keri/DB_LAYER_KV_GATE_H_BACKLOG.csv`

## Non-Negotiable Rules

1. LMDB parity first:
   - Implement KERIpy LMDB DB behavior feature-by-feature to full parity before
     coding provider abstraction.
2. No parity shortcuts:
   - Avoid ad hoc command-level bypasses that hide DB-layer gaps.
3. Inventory-driven closure:
   - Track K/V coverage with `lmdb-dumper.md` and explicit parity matrix rows.
4. Interop-first verification:
   - Validate behavior with KERIpy interop scenarios, not only unit tests.
5. Storage-semantics isolation:
   - While LMDB remains the only real backend in Phase 2, new app-layer work
     should consume typed DB seams and semantic contracts rather than depending
     on LMDB-specific cursor/order/dupsort details directly.

## Workstream Sequence

## D0 - Inventory and Parity Matrix

Deliverables:

- Function/class matrix for `dbing.py`, `subing.py`, `koming.py`,
  `recording.py`, `basing.py`, and `escrowing.py`.
- Mapping to target `keri-ts` files/classes.
- Status columns: `Missing`, `Partial`, `Equivalent`, `Tested`.
- K/V inventory table seeded from `lmdb-dumper.md`.
- Gate-scoped K/V classification for current-phase execution:
  - explicit `gate` and `gate_rationale` columns in Gate A-G worklist rows.
- Published D0 artifacts:
  - `docs/plans/keri/DB_LAYER_PARITY_MATRIX.md`
  - `docs/plans/keri/DB_LAYER_KV_PARITY_MATRIX.csv`
  - `docs/plans/keri/DB_LAYER_KV_GATE_AG_WORKLIST.csv`
  - `docs/plans/keri/DB_LAYER_KV_GATE_H_BACKLOG.csv`

Exit criteria:

- Every baseline API and K/V domain appears in one matrix row with owner and
  planned phase.

## D1 - `dbing.py` Core Parity

Deliverables:

- LMDB environment lifecycle parity (open/close/reopen semantics).
- Key encoding/decoding helpers and iterator behavior parity.
- Duplicate-set and ordered iteration semantics parity where used by downstream
  classes.
- Versioning/migration hooks needed by DB open/reopen paths.

Exit criteria:

- DB primitives are sufficient for Suber/Komer migration without raw-path
  one-offs.

## D2 - `subing.py` Class Family Parity

Deliverables:

- Implement required Suber family variants used by Keeper/Baser/Reger/Mailboxer
  paths.
- Ensure CESR-focused encoders/decoders align with KERIpy value handling.
- Ensure category/concat semantics (e.g., CatCesr-like layouts) match expected
  composite-key behavior.

Exit criteria:

- Current phase command surfaces no longer depend on raw LMDB wrappers where
  Suber variants are expected.

## D3 - `koming.py` Class Family Parity

Deliverables:

- Implement typed object serialization/deserialization parity for Komer classes.
- Align key-prefixing, schema/object mapping, and iterator query behavior.

Exit criteria:

- Typed state rows in baser/keeper/regery/mailbox paths are Komer-backed where
  KERIpy uses Komer-backed patterns.

## D4 - Databaser Class Parity (`basing.py` surface)

Deliverables:

- Incremental parity for `Baser`, `Keeper`, `Reger`, `Noter`, `Mailboxer`
  foundational DB setup and required named sub-databases.
- Initial K/V coverage focused on init/incept/comms/OOBI/challenge gates.

Exit criteria:

- No structural blockers remain for Gate A/B/E/F/G flows in the parent plan.

## D5 - Escrow Infrastructure (`escrowing.py` parity slice)

Deliverables:

- Escrow tables/structures and processing loops needed by phase scope.
- Retry, timeout, and state-transition handling needed for OOBI/comms/challenge
  flows.

Exit criteria:

- Escrow processing is functional for all phase-required flows.

## D6 - CLI-Critical DB Integration

Deliverables:

- Confirm DB-layer behavior unlocks:
  - `init`, `incept`, `list`, `aid`
  - `ends add`
  - `oobi generate/resolve`
  - direct/mailbox communications
  - `challenge generate/respond/verify`

Exit criteria:

- Parent plan Gates A through G pass with DB-backed behavior (no temporary
  in-memory substitutions).

## D7 - LMDB Full-Parity Closure

Deliverables:

- Complete remaining DB-layer feature and K/V coverage not required for early
  gates but required for parity closure.
- Resolve all matrix rows to `Equivalent` or explicit deferred-phase exclusion
  approved in writing.

Exit criteria:

- Gate H (parent plan) is green.
- DB parity matrix is fully reviewed and signed off.

## D8 - Provider Abstraction Design and Implementation (Post-Parity)

Deliverables:

- Define DB provider interface(s) based on stabilized LMDB parity semantics.
- Implement provider abstraction with LMDB adapter first.
- Prepare adapter contract tests for future IndexedDB/SQLite providers.

Exit criteria:

- Abstraction layer exists without changing observable LMDB behavior.

## Verification Strategy

1. Module-level parity tests:
   - For each mapped function/class, add direct parity tests where practical.
2. Workflow interop tests:
   - Use parent-plan Gate scenarios across two controllers.
   - Harness source:
     - `packages/keri/test/integration/app/interop-gates-harness.test.ts`
     - `docs/plans/keri/KLI_TUFA_COMMAND_PARITY_MATRIX.md`
3. Database evidence tests:
   - Expand `tufa db dump` and compare DB evidence with KERIpy ground truth.
4. Encrypted-store tests:
   - Include passcode + AEID unlock/decrypt validation for private data paths.

## Priority Order (Execution)

1. D0 Inventory/parity matrix
2. D1 DB core (`dbing.py`)
3. D2 Suber family
4. D3 Komer family
5. D4 Databaser classes
6. D5 Escrowing
7. D6 CLI-critical integration gates
8. D7 LMDB full closure
9. D8 Provider abstraction (post-parity only)

## Completion Condition

This DB plan is complete when:

1. D0-D7 are done and Gate H from the parent plan is green.
2. `tufa` demonstrates stable DB-backed interop for init/incept/comms/OOBI/
   challenge flows.
3. Provider abstraction implementation starts only after D7 closure.
