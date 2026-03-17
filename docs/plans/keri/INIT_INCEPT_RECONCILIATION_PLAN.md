# Phase 2 Plan: KERIpy DB Layer Parity + Usable Controller Interop (kli -> tufa)

## Program Context

This is Phase 2 of a 4-phase project.

- Phase 1 (completed): CESR parser completeness/parity.
- Phase 2 (this plan): KERIpy DB layer parity + usable controller
  interoperability.
- Later phases: broader KERI/AIDC feature expansion (rotation/witness/watcher,
  multisig, ACDC, IPEX, and beyond).

## Primary Outcomes

1. Deliver a usable interop baseline modeled on
   `/Users/kbull/code/keri/kentbull/keripy/scripts/demo/basic/challenge.sh`.
2. Build KERIpy-equivalent LMDB database infrastructure in `keri-ts` so code
   translation and behavior verification are reliable.
3. Complete LMDB layer feature parity first; only then implement multi-provider
   storage abstraction (IndexedDB/SQLite/etc), with implementation of
   abstraction delayed until LMDB parity closure.

## Non-Negotiable Design Requirements

1. Default storage isolation remains intentional:
   - `tufa` defaults to `tufa`-owned areas (`$HOME/.tufa`, tufa system path).
2. Compatibility mode is explicit and opt-in:
   - `tufa` can read KERIpy path layout (`$HOME/.keri`, keri system path) when
     enabled by CLI arg or `$HOME/.tufa/config.yaml`.
3. LMDB-first implementation rule:
   - Implement KERIpy LMDB DB layer feature-by-feature, to full parity in this
     phase, before provider abstraction implementation.
4. Abstraction timing rule:
   - Database provider abstraction design can be specified now, but code-level
     implementation starts only after LMDB parity closure.

## Scope

In scope now:

- Usable CLI/controller flow parity:
  - `init`, `incept`, `list`, `aid`, `ends add`
  - `oobi generate`, `oobi resolve`
  - `challenge generate`, `challenge respond`, `challenge verify`
- Direct-mode and mailbox-mode communications interoperability with KERIpy.
- Database-layer parity infrastructure:
  - `dbing.py`-equivalent primitives and behaviors.
  - `subing.py` class family.
  - `koming.py` class family.
  - `basing.py` and `escrowing.py` equivalents in `keri-ts`.
  - `LMDBer/Baser/Mailboxer/Noter/Reger/Keeper` parity path.
- `tufa db dump` improvements for parity/debug evidence.

Out of scope for immediate completion:

- Witness/delegation breadth closure.
- Multisig/ACDC/IPEX breadth closure.
- Full alternative-provider runtime implementation before LMDB parity closure.

## DB Planning Artifact

A dedicated DB sub-plan is part of this phase:

- `docs/plans/keri/DB_LAYER_RECONCILIATION_PLAN.md`
- `docs/plans/keri/DB_LAYER_PARITY_MATRIX.md`
- `docs/plans/keri/DB_LAYER_KV_PARITY_MATRIX.csv`
- `docs/plans/keri/DB_LAYER_KV_GATE_AG_WORKLIST.csv`
- `docs/plans/keri/DB_LAYER_KV_GATE_H_BACKLOG.csv`

It tracks detailed parity for classes/functions from KERIpy DB modules and the
K/V surface from `docs/design-docs/db/lmdb-dumper.md`.

## Baseline Findings (Current)

1. Default `.tufa` isolation and explicit `--compat` path routing are both
   implemented, and `tufa list` / `tufa aid` now have live interop evidence
   against KLI-created encrypted `.keri` stores.
2. Gate B bootstrap CLI parity is now live-evidenced for
   `init`/`incept`/`export`/`list`/`aid`; endpoint/OOBI/comms/challenge breadth
   remains absent or blocked by missing command surfaces.
3. AEID association checks, readonly safety rails, and compat-store visibility
   are in place, but true encrypted secret semantics versus KERIpy remain
   incomplete.
4. `Manager`, `Hab`, and `Signator` now use primitive-first signing surfaces
   and `Hab.make()` builds inception events through `SerderKERI`, but signator
   reopen / decrypt lifecycle reliability is still incomplete.
5. The DB layer bootstrap path now runs through typed `Suber` / `Komer`
   wrappers with broad `Baser` / `Keeper` named-subdb binding, but escrow
   infrastructure and row-by-row parity closure are still open.

## Hard Gates

### Gate A: DB Foundation + Escrow Infrastructure Readiness

Required outcomes:

- Sufficient LMDB layer and typed DB primitives are in place to support
  init/incept/comms/OOBI/challenge flows without ad hoc shortcuts.
- Escrow processing infrastructure is functional for the features in this phase.

### Gate B: Bootstrap CLI Usability (`init`/`incept`/`list`/`aid`)

For one controller (`cha1`) in both default mode and compatibility mode:

1. `init`
2. `list` before `incept` shows no identifiers.
3. `incept`
4. `list` after `incept` shows `alias (prefix)`
5. `aid --alias <alias>` returns the same prefix.

This gate explicitly includes the `kli list`/`kli aid` parity checks you asked
for.

### Gate C: KLI Store Unlock + Visibility (Compatibility Mode)

- `tufa` opens KLI-created stores (encrypted + unencrypted).
- `tufa list` and `tufa aid` reflect identifiers correctly.

### Gate D: Encrypted Data-at-Rest Semantics

- AEID paths match KERIpy expectations for encrypted salt/keys and re-encryption
  behavior.

### Gate E: Endpoint + OOBI Bootstrap (`ends add`, `oobi`)

Across `cha1`/`cha2`:

- `ends add` persists mailbox role auth usable by OOBI logic.
- `oobi generate` and `oobi resolve` interoperate with KERIpy.

### Gate F: Communications Interop (Direct + Mailbox)

- Basic controller-to-controller messaging works in direct mode.
- Messaging works via KERIpy mailbox infrastructure.

### Gate G: Challenge Interop

- `challenge generate/respond/verify` succeeds across two controllers with
  resolved peer state and selected transport path.

### Gate H: LMDB Layer Full-Parity Closure (Phase 2 tail)

- KERIpy LMDB DB layer is implemented feature-by-feature in `keri-ts`, including
  DB primitives/class families targeted in this phase plan, with no unresolved
  parity gaps in `dbing.py`, `subing.py`, `koming.py`, `basing.py`, and
  `escrowing.py` for this phase scope.
- Remaining K/V pairs not needed for earlier gates are completed by parity work
  extension before moving to provider abstraction implementation.

## Sensible Order of Operations

## P0 - Harness + Parity Matrices

- Build/expand interop harness for Gate A-G checks.
- Add matrix for KERIpy command parity and expected output shape.
- Seed DB parity matrix from `lmdb-dumper.md` and KERIpy module APIs.

P0 tracking artifacts:

- `docs/plans/keri/KLI_TUFA_COMMAND_PARITY_MATRIX.md`
- `packages/keri/test/integration/app/interop-gates-harness.test.ts`
- `docs/plans/keri/DB_LAYER_PARITY_MATRIX.md`
- `docs/plans/keri/DB_LAYER_KV_PARITY_MATRIX.csv`
- `docs/plans/keri/DB_LAYER_KV_GATE_AG_WORKLIST.csv`
- `docs/plans/keri/DB_LAYER_KV_GATE_H_BACKLOG.csv`

## P1 - DB Core (`dbing.py`) Parity Slice

- LMDB environment lifecycle, DB open/close/reopen, iterators, dup behavior,
  version/migration scaffolding, required key helpers.

## P2 - `subing.py` + `koming.py` Parity Slice

- Implement critical Suber and Komer class families needed for this phase.
- Ensure typed value serialization/deserialization and iterator semantics match
  intended KERIpy behavior.
- Current state: the bootstrap-critical `Suber` / `Komer` slice is landed and
  live in `Baser` / `Keeper`, including typed CESR and serder wrappers; full
  row-by-row family closure is still open.

## P3 - Databaser Classes + Required Sub-DB Surface

- Build out `Baser/Keeper/Reger/Noter/Mailboxer` infrastructure for current
  feature gates (not every K/V pair yet, but enough to stop structural churn).

## P4 - Escrowing Infrastructure (`escrowing.py`) Parity Slice

- Implement escrow framework/process loops needed by OOBI/comms/challenge paths.

## P5 - Path Modes + Bootstrap Commands

- Complete default-isolated path mode and explicit compatibility mode.
- Land/finish `init`, `incept`, `list`, `aid` parity flow (Gate B/C).
- Current state: Gate B is implemented with live interop evidence, and Gate C
  visibility now passes live against encrypted KLI stores; the next blocker is
  Gate D encrypted secret semantics, not basic compat-store opening.

## P6 - AEID + Manager + Signator Reliability

- Complete encryption/decryption lifecycle parity.
- Fix signator reopen behavior and related command stability.
- Current state: primitive-first signing and AEID association checks are landed,
  but decrypt/re-encrypt parity and reopen reliability are still open.

## P7 - `ends add` + Endpoint State

- Implement endpoint role authorization path and persistence.
- Ensure mailbox role data supports OOBI/mailbox flow.

## P8 - OOBI Generate/Resolve

- Implement OOBI command parity needed for two-controller bootstrap.

## P9 - Direct + Mailbox Communications

- Implement both transport tracks for interop with KERIpy
  participants/mailboxes.

## P10 - Challenge Commands

- Implement challenge command set parity and verify with interop tests.

## P11 - `db dump` Expansion

- Expand dump/readability/decode tooling for encrypted and comms-critical state.

## P12 - LMDB Full-Parity Closure (Gate H)

- Finish remaining DB-layer features and K/V coverage not yet completed.
- Validate no temporary compatibility shortcuts remain in core DB behavior.
- Confirm feature-by-feature parity completion against KERIpy reference modules
  and `docs/design-docs/db/lmdb-dumper.md` inventory.

## P13 - Provider Abstraction Implementation (Post-LMDB Parity)

- Implement DB provider abstraction layer for pluggable K/V backends.
- First provider remains LMDB; add adapters for IndexedDB/SQLite in follow-on
  increments.

## Recommended Next Focus (2026-03-17)

1. Gate D: close encrypted keeper semantics, AEID decrypt/re-encrypt parity, and
   signator reopen reliability.
2. Gate E: implement `ends` / `oobi` command surfaces on top of the endpoint and
   OOBI stores that are already bound in `Baser`.
3. Gate A/H bookkeeping: refresh the DB-layer symbol and K/V matrices so the
   plans stop understating landed `Suber` / `Komer` / `Baser` work.
4. Gate F/G readiness: add escrow/process-loop infrastructure needed for
   endpoint, OOBI, comms, and challenge flows before chasing higher-level CLI
   parity.

## Milestones

### M1 - Usable Interop Baseline

Pass Gate A through Gate G.

### M2 - LMDB Parity Closure

Pass Gate H.

### M3 - Pluggable Storage Foundation

Complete P13 after M2.

## Verification Matrix (Minimum)

1. `init -> list(empty) -> incept -> list(alias+pre) -> aid(pre)`
2. Same sequence in compatibility mode against KLI-created stores.
3. `ends add` mailbox role auth flow.
4. `oobi generate/resolve` between `cha1` and `cha2`.
5. Direct-mode comms baseline.
6. Mailbox-mode comms baseline with KERIpy mailbox infra.
7. Challenge round-trip between controllers.
8. Encrypted-store unlock + behavior checks.
9. DB evidence via `tufa db dump` (raw and decoded where applicable).

## Completion Condition for This Phase

This Phase 2 track is complete when:

- M1 and M2 are green.
- Default `.tufa` isolation remains intact.
- Compatibility mode reliably interops with KERIpy stores and mailboxes.
- Provider abstraction implementation begins only after LMDB full-parity
  closure.
