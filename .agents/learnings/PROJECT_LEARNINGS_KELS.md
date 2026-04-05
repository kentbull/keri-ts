# PROJECT_LEARNINGS_KELS

## Purpose

Persistent learnings for KEL processing, event-state transitions, replay, and
runtime ownership semantics.

## Current State

1. Phase 2 remains parity-first. The DB foundation is strong enough to support
   real runtime work, and the active edge has moved from raw storage bootstrap
   into runtime, key-management, and `kli`/`tufa` interoperability closure.
2. `docs/design-docs/db/db-architecture.md` is the storage contract for
   ordering, duplicate semantics, lifecycle, serialization, and reopen behavior.
3. `LMDBer` coverage now includes the core `On*`, `IoSet*`, `Dup*`, and `IoDup*`
   families needed by downstream `Suber` / `Komer` / `Baser` / `Keeper` work,
   and the DB parity matrix has been re-audited against current source.
4. The remaining DB problem is no longer "missing broad surface area." It is
   promotion of high-value `Partial` rows with stronger parity evidence,
   especially `fetchTsgs` and the `Komer` family.
5. Exact interoperability contracts matter: keep `lmdb` pinned to `3.4.4`,
   preserve `LMDB_DATA_V1=true` for KERIpy interop workflows, and route
   protocol/storage CBOR through the shared CESR codec for exact `cbor2` byte
   parity.
6. Typed `Suber` / `Komer` wrappers now back active `Baser` / `Keeper` stores;
   `KomerBase -> Komer`, `DupKomer`, and the newer normalized ordinal-wrapper
   APIs are part of the parity path.
7. The forward ordinal-wrapper surface is the newer `getTop*` / `getAll*` /
   non-`On` family. Older `getOn*` names remain temporary compatibility aliases
   where upstream KERIpy has not finished migrating.
8. Record-model parity is now `FooRecord` plus `FooRecordShape`, with
   `recordClass` as the durable public seam. Exported `*Like` aliases and public
   `hydrate` / `normalize` hooks are drift.
9. Generic wrapper types are part of the parity contract. Use the narrowest real
   record, primitive, or explicit tuple type instead of widened `Matter`
   fallbacks.
10. Local identifier state is DB-backed: `states.` is the durable source of
    truth, `kels.` / `fels.` / `dtss.` support reopenable event state, and
    `Habery.habs` is only an in-memory cache of reconstructed `Hab` objects.
11. For `Baser` and `Keeper`, named-subdb meaning is most honestly documented on
    `reopen()` bindings where property name, subkey, wrapper type, and
    tuple/value wiring appear together.
12. Local key-management surfaces should stay primitive-first. `Manager` returns
    and consumes CESR primitives directly, `Signator` matches KERIpy's
    detached-signature mental model, and keeper encryption stays primitive-owned
    instead of becoming keeper-local crypto machinery.
13. The parser-to-runtime dispatch seam is a first-class architecture surface in
    `core/dispatch.ts`. Keep KERIpy family names (`tsgs`, `trqs`, `ssgs`,
    `frcs`, `sscs`, `ssts`, and related families), but model family elements as
    named value objects carrying real CESR primitives plus derived getters.
14. Ordinal-bearing dispatch material currently needs
    `DispatchOrdinal = Seqner | NumberPrimitive`; forcing everything into
    `Seqner` is false parity because it ignores what the current parser actually
    emits.
15. KEL control flow should stay TypeScript-native: normal outcomes are typed
    decisions (`accept`, `duplicate`, `escrow`, `reject`), `Kever` decides
    state-machine validity, and `Kevery` owns routing, escrow persistence,
    duplicate handling, and post-acceptance side effects.
16. `docs/adr/adr-0005-kel-decision-control-flow.md` is the normative contract
    for that state-machine/orchestrator split and should guide future
    `Tever`/`Tevery`-style ports as well.
17. Accepted identifier state should live on `Kever` / `Baser`, not on ad hoc
    habitat projections. Local inception needs to flow through the same `Kevery`
    acceptance path used for remote processing.
18. Weighted threshold parity is end to end: `Tholder` owns threshold semantics,
    structured `kt` / `nt` payloads are allowed in serder/state storage, and
    both `Kever` and `Revery` should rely on `tholder.satisfy(...)` instead of
    numeric shortcuts.
19. Cue ownership is dual-scope, matching KERIpy more honestly than an
    "everything hangs off AgentRuntime" story. `AgentRuntime` holds the shared
    runtime cue deck for runtime-hosted processing, while `Habery.kevery` owns a
    separate local cue deck for `Hab` local event/receipt acceptance.
20. `Hab.processCuesIter()` remains the cue-semantics seam across both scopes,
    and runtime delivery happens through `processCuesOnce()` / `cueDo()`
    yielding structured `CueEmission` values.
21. Reply/runtime ownership is also explicit: `Revery` verifies, BADA-checks,
    and escrows reply traffic; `Kevery` owns KEL and KEL-derived reply families
    such as `/ksn`; `Oobiery` owns introduction-driven OOBI behavior.
22. Local location-scheme state must arrive through signed `/loc/scheme` replies
    parsed back through `Revery`, not by direct writes to `locs.` / `lans.`.
23. Runtime turns should stay Effection-native. Promise adaptation belongs only
    at real host edges such as `fetch()`, dynamic import, or server-finished
    handles.
24. Gates B, C, and D are established enough to stop debating bootstrap
    viability: local visibility, compat-store visibility, and encrypted keeper
    semantics are real foundations now.
25. Gate E now has a real shared runtime, mailbox/OOBI/query/receipt slice, and
    bounded init/incept convergence, but it is still an honest bootstrap slice
    rather than full KERIpy runtime closure.
26. The remaining gaps are narrower and clearer now: promote key DB `Partial`
    rows, finish forwarding/exchange/direct transport breadth, harden
    stale/timeout continuation behavior, and keep receipt/query/escrow parity
    honest.

## Use This Doc For

1. Event validation and ordering rules.
2. Replay behavior and accepted-state ownership.
3. DB parity, runtime architecture, and KERIpy interop nuances.

## Key Docs

1. `docs/design-docs/db/db-architecture.md`
2. `docs/adr/adr-0005-kel-decision-control-flow.md`
3. `docs/adr/adr-0002-path-manager-filer-seam.md`
4. `docs/plans/keri/DB_LAYER_PARITY_MATRIX.md`
5. `docs/plans/keri/DB_LAYER_RECONCILIATION_PLAN.md`
6. `docs/plans/keri/GATE_E_AGENT_RUNTIME_OOBI_PLAN.md`

## Current Follow-Ups

1. Keep KEL-state work parity-first on top of DB invariants rather than adding
   abstraction before behavior closure.
2. Continue the Gate E continuation / Gate F bridge with focus on
   forwarding/exchange/direct transport breadth, stale/timeout behavior, and
   remaining query/receipt edge cases.
3. Promote high-value DB `Partial` rows with real row-level evidence instead of
   symbol-existence optimism.
4. Treat missing maintainer docs on newly ported KERIpy surfaces as a real
   regression.
5. Keep DB/runtime worklists concise and execution-oriented; when the docs start
   reading like archives again, compact them.

## Milestone Rollup

### 2026-03-02 to 2026-03-18 - DB Foundation And Wrapper Parity Became Real

- Established the DB parity matrix and reconciliation artifacts, expanded
  `LMDBer` family coverage, and reorganized docs/tests around storage families
  instead of representation sweeps.
- Landed `KomerBase -> Komer`, serializer support at the mapper boundary, and
  the normalized ordinal-wrapper surface needed for later higher-layer parity.

### 2026-03-14 to 2026-03-17 - Visibility, Local State, And Inception Foundation Landed

- Landed Gate B local visibility, live Gate C compat-store visibility, eager
  habitat reload on open, exact shared-CBOR parity, and `SerderKERI`-based local
  inception instead of ad hoc saidify helpers.
- Moved local state onto the DB backbone so `states.` / `kels.` / `fels.` /
  `dtss.` became the durable source of truth instead of process-local habitat
  projections.

### 2026-03-27 to 2026-03-29 - Runtime Architecture Boundaries Were Locked

- Added the `PathManager` ADR so path policy stays separate from LMDB/config
  resource ownership.
- Landed the shared `AgentRuntime` cue/deck seam, required Effection-native
  orchestration, and expanded `KeriDispatchEnvelope` into the real
  parser-to-runtime family/value-object boundary.

### 2026-03-29 to 2026-04-02 - `Kever` And Threshold Semantics Moved To The Right Layer

- `Kever` now owns accepted key state and typed decision outcomes.
- Decision helpers, attachment validation, delegated recovery, and reply/KEL
  verification were tightened around the `Kever`/`Kevery` split plus
  primitive-owned crypto dispatch.
- Backer and weighted-threshold behavior now stays exact through `Tholder`
  rather than leaking into numeric shortcuts.

### 2026-04-02 - Keeper And Signing Parity Tightened

- `Manager.sign({ pre, path })`, `Signator`, and keeper encryption were aligned
  with KERIpy's primitive-owned crypto mental model instead of keeper-local or
  wrapper-record shortcuts.

### 2026-04-03 - Gate E Became Honest And Useful

- Shared runtime now covers `/ksn`, `/introduce`, mailbox streaming, bounded
  init/incept convergence, receipt and witness cue emission, inbound `rct`
  handling, verified receipt persistence, unverified-receipt escrows, and
  durable query-not-found retry behavior.
- The remaining runtime gap is now specific rather than vague:
  forwarding/exchange/direct transport breadth, richer cue consumers, and
  stricter stale/timeout continuation parity.

### 2026-04-04 - Habery-Local `Kevery` Ownership Was Restored

- `Habery` now owns a local `kevery` again, and `Hab` instances use that
  injected processor for local inception and receipt acceptance instead of
  constructing ad hoc `Kevery` objects.
- The cue model is now explicit and dual-scope: runtime hosts own a shared
  runtime cue deck, while `Habery.kevery` owns a separate local cue deck for
  habitat-local processing. Do not collapse those scopes without a stronger
  parity reason.
- Live transferable `rct` processing should follow KERIpy's grouped `tsgs`
  mental model. Reserve `trqs` for replay/clone attached transferable receipt
  quadruples and keep any flattening into `vres.` / `vrcs.` as a storage detail
  rather than the live receipt API shape.
- Receipt escrow naming should mirror KERIpy too: use the explicit
  `escrowUReceipt`, `escrowUWReceipt`, `escrowTRGroups`, and `escrowTReceipts`
  seams instead of hiding the four cases behind one combined receipt-escrow
  helper.
- For KEL/readability work, prefer small domain-named helpers when repeated
  policy branches obscure the mental model. Helpers such as
  `ownReceiptConflict(...)` are good when they name a real parity rule and make
  branch behavior easier to review; generic abstraction for its own sake is not.
- Escrow replay should follow the same explicit control model everywhere:
  `accept`, `keep`, and `drop` as typed decisions with labeled reasons. Use that
  for `Kevery` receipt/query replay, `Revery` reply replay, and `Broker` retry
  loops instead of mixing string unions, boolean tests, and recoverable
  exception handling styles.

### 2026-04-03 - DB Audit And Record-Model Cleanup Closed The Old Missing-Surface Story

- Re-audited the DB parity matrix against current source.
- Landed the earlier five missing rows (`RawRecord`, `OobiQueryRecord`,
  `DupKomer`, `BaserDoer`, `Broker`) and reframed the real next step as
  evidence-driven `Partial` promotion.
- Tightened the public mapper API around `recordClass` plus `FooRecord` /
  `FooRecordShape` and removed the old `*Like` naming drift.
