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
4. Keep storage-facing semantics isolated while doing LMDB-first work so later
   provider support is an adapter exercise, not a behavioral rewrite.

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
5. Storage-semantics isolation rule:
   - Even before provider abstraction exists, app and keeper code should avoid
     depending directly on LMDB-specific ordering, dupsort quirks, or raw-handle
     assumptions beyond the DB seam.

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
- IndexedDB/mobile-web storage implementation before 1.0 / LMDB parity closure.

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
   `init`/`incept`/`export`/`list`/`aid`, and `init` / `incept` now host
   bounded command-local runtime convergence when queued bootstrap OOBIs exist
   instead of stopping at config preload.
3. Gate D is now live-evidenced: keeper-global salt, per-prefix salts, and
   `pris.` signer seeds use real sealed-box encryption with AEID
   decrypt/re-encrypt behavior and wrong-passcode failure coverage.
4. `Manager`, `Hab`, and `Signator` now use primitive-first signing surfaces,
   `Hab.make()` builds inception events through `SerderKERI`, and encrypted
   signator reopen behavior is covered by focused reopen tests.
5. The DB layer bootstrap path now runs through typed `Suber` / `Komer` wrappers
   with broad `Baser` / `Keeper` named-subdb binding, and the escrow/runtime
   infrastructure is now strong enough for honest bootstrap/runtime work. The
   remaining DB parity problem is narrower row-by-row closure, especially the
   highest-value `Partial` rows and fuller `Komer` evidence.
6. Browser/mobile storage remains deferred until after 1.0, but the codebase
   should keep storage-facing semantics isolated now so later IndexedDB support
   does not become a hidden rewrite.

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
- Status: implemented in `keri-ts` with live harness evidence plus focused unit
  coverage for keeper reopen, wrong-passcode rejection, AEID re-encryption, and
  signator reopen.

### Gate E: Endpoint + OOBI Bootstrap (`loc add`, `ends add`, `oobi`, `agent`)

Across `cha1`/`cha2`:

- `loc add` persists accepted `LocationScheme` replies through the shared
  runtime.
- `ends add` persists mailbox role auth usable by OOBI logic.
- `oobi generate` and `oobi resolve` interoperate with KERIpy.
- `tufa agent` serves only protocol routes needed for bootstrap OOBI/resource
  exchange.
- Design and implementation details for this gate are tracked in the dedicated
  subplan:
  - `docs/plans/keri/GATE_E_AGENT_RUNTIME_OOBI_PLAN.md`
- Current status: Gate E is now materially complete for the honest
  bootstrap/runtime slice, including bounded `init` / `incept` convergence.
  What remains is no longer bootstrap reply/query/receipt plumbing. It is the
  Gate F bridge around richer communications/transport breadth plus the broader
  stale/timeout continuation tail.

#### Gate E Follow-On After `init` / `incept` Closure

- Treat the old Gate E continuation story as substantially closed:
  - Chunks 1 through 10 now cover the honest bootstrap/runtime/query/receipt
    slice
  - `/ksn`, `/introduce`, fuller cue materialization, receipt/query escrows,
    and reply-based OOBI continuation are no longer the active blocker for
    `init` / `incept`
- `tufa init` now hosts the shared runtime when queued `oobis.` / `woobi.` work
  exists, waits for bounded convergence, and fails if bootstrap OOBIs end in
  `eoobi.`
- `tufa incept` now performs the same bounded convergence before local
  identifier creation. It is no longer "runtime blind".
- The active follow-on is:
  - Gate F transport/comms breadth across direct, mailbox, forwarding, and
    exchange paths
  - the broader stale/timeout continuation tail
  - packaged npm/tarball confidence for `tufa agent`

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

Current state:

- The parity/planning artifacts exist and have been useful enough to stop
  treating Phase 2 as a purely exploratory effort.
- The next harness value is honest packaged-boundary coverage for `tufa agent`,
  not more bootstrap-only source-path optimism.

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

Current state:

- Strong enough for the active Phase 2 runtime and interoperability work.
- The main remaining DB problem is not missing basic lifecycle primitives. It
  is row-level parity closure and evidence.

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

Current state:

- Broad named-subdb binding is landed across `Baser` / `Keeper`, and the active
  runtime/bootstrap work no longer depends on ad hoc storage shortcuts.
- The remaining work is completeness and evidence, not structural viability.

## P4 - Escrowing Infrastructure (`escrowing.py`) Parity Slice

- Implement escrow framework/process loops needed by OOBI/comms/challenge paths.

Current state:

- Strong enough for honest Gate E behavior: continuous runtime escrow loops,
  reply escrow/replay, receipt-family escrows, and query-not-found replay are
  all real.
- Remaining escrow work is the broader stale/timeout policy tail plus later
  feature families, not missing Phase 2 bootstrap plumbing.

## P5 - Path Modes + Bootstrap Commands

- Complete default-isolated path mode and explicit compatibility mode.
- Land/finish `init`, `incept`, `list`, `aid` parity flow (Gate B/C).
- Current state: Gate B is implemented with live interop evidence, and Gate C
  visibility now passes live against encrypted KLI stores; Gate D encrypted
  secret semantics are also closed; and Gate E bootstrap/runtime parity now
  includes bounded `init` / `incept` convergence. The next blocker is
  communications/runtime breadth rather than keeper unlock or bootstrap
  endpoint work.

## P6 - AEID + Manager + Signator Reliability

- Complete encryption/decryption lifecycle parity.
- Fix signator reopen behavior and related command stability.
- Current state: decrypt/re-encrypt parity and signator reopen reliability are
  landed with sodium-backed sealed-box behavior and reopen tests; remaining work
  has moved outward to endpoint/OOBI/comms breadth.

## P7 - `ends add` + Endpoint State

- Implement endpoint role authorization path and persistence.
- Ensure mailbox role data supports OOBI/mailbox flow.
- Current state: closed for the Gate E bootstrap slice, with live parity
  evidence for `tufa ends add`, runtime-backed persistence, and OOBI/resource
  serving from stored endpoint/auth material.

## P8 - OOBI Generate/Resolve

- Implement OOBI command parity needed for two-controller bootstrap.
- Current state: closed for the Gate E bootstrap slice, with live mailbox
  generate/resolve parity against KERIpy, local shared-runtime coverage for
  controller, witness, mailbox, and agent OOBIs, and `/introduce`-driven
  continuation staying on the same durable runtime path.

## P8.5 - Gate E Continuation For `init` / `incept`

- Current status:
  - materially complete for the honest bootstrap/runtime slice
  - `tufa init` now mirrors KERIpy's bootstrap intent closely enough to be
    honest: it hosts the command-local runtime when queued bootstrap work
    exists, waits for bounded convergence, and fails on unresolved bootstrap
    OOBIs
  - `tufa incept` now performs the same bounded bootstrap convergence before
    local identifier creation instead of assuming that "local" means
    "runtime-blind"
  - the old continuation blockers are landed for this slice:
    - `/ksn` reply handling
    - `/introduce` reply handling
    - fuller cue materialization
    - unverified receipt-family/query escrows
    - broader reply-based OOBI continuation
  - the remaining work is no longer init/incept honesty. It is Gate F transport
    breadth and the broader stale/timeout continuation tail

## P9 - Direct + Mailbox Communications

- Implement both transport tracks for interop with KERIpy
  participants/mailboxes.

Current state:

- This is now the main active blocker after Gate E.
- The indirect/shared-runtime host, mailbox stream slice, and protocol-only
  server are real, but fuller direct-mode, forwarding, exchange, and richer
  mailbox communications breadth are not yet closed.
- `tufa agent` also has a packaged-runtime confidence seam here: source-path
  evidence is not enough unless the packed npm artifact starts cleanly too.

## P10 - Challenge Commands

- Implement challenge command set parity and verify with interop tests.

Current state:

- Still a later gate.
- The important planning constraint is that challenge work should build on the
  landed shared runtime and communications seams instead of inventing a bypass.

## P11 - `db dump` Expansion

- Expand dump/readability/decode tooling for encrypted and comms-critical state.

Current state:

- Still useful and still later than the runtime/comms blocker.
- It remains a verification/evidence amplifier, not the next architectural
  blocker.

## P12 - LMDB Full-Parity Closure (Gate H)

- Finish remaining DB-layer features and K/V coverage not yet completed.
- Validate no temporary compatibility shortcuts remain in core DB behavior.
- Confirm feature-by-feature parity completion against KERIpy reference modules
  and `docs/design-docs/db/lmdb-dumper.md` inventory.

Current state:

- Still active as the Phase 2 tail.
- The remaining work is narrower than before: promote the highest-value
  `Partial` rows, strengthen `Komer` row-level evidence, and finish the
  remaining K/V coverage without reopening already-stable DB foundations.

## P13 - Provider Abstraction Implementation (Post-LMDB Parity)

- Implement DB provider abstraction layer for pluggable K/V backends.
- First provider remains LMDB; add adapters for IndexedDB/SQLite in follow-on
  increments.

Current state:

- Unchanged. Still post-LMDB-parity work, not a present implementation target.

## Recommended Next Focus (2026-04-05)

1. Gate F bridge: build on the now-landed shared runtime and close direct,
   mailbox, forwarding, and exchange transport breadth instead of reopening
   bootstrap/runtime foundations.
2. Runtime hardening: finish the broader stale/timeout continuation tail and
   cleanup policy now that the core query/reply and receipt/query slices are
   landed.
3. `tufa agent` release confidence: keep smoke coverage honest at the packed
   npm/tarball boundary so source-path success does not hide Node/runtime drift.
4. Gate H tail: keep DB parity closure moving so the wider runtime work does
   not accrete new storage shortcuts or row-level drift.

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
4. `init` with config-seeded `iurls` / `durls` / `wurls` drives runtime
   resolution/auth convergence instead of only preloading DB state.
5. `oobi generate/resolve` between `cha1` and `cha2`, including reply-driven
   continuation where needed.
6. `incept` can rely honestly on accepted remote transferable prerequisites
   when those are part of the requested flow.
7. Direct-mode comms baseline.
8. Mailbox-mode comms baseline with KERIpy mailbox infra.
9. Challenge round-trip between controllers.
10. Encrypted-store unlock + behavior checks.
11. DB evidence via `tufa db dump` (raw and decoded where applicable).
12. Packed npm/tarball smoke for `tufa agent` proves `init -> incept -> agent ->
    /health` on the artifact users actually install.

## Completion Condition for This Phase

This Phase 2 track is complete when:

- M1 and M2 are green.
- Default `.tufa` isolation remains intact.
- Compatibility mode reliably interops with KERIpy stores and mailboxes.
- Provider abstraction implementation begins only after LMDB full-parity
  closure.
