# PROJECT_LEARNINGS_KELS

## Purpose

Persistent learnings for KEL processing, DB parity, replay, runtime ownership,
and KERIpy interoperability.

## Current State

1. Phase 2 remains parity-first. The broad DB foundation is in place; the active
   edge is runtime, key-management, and `kli`/`tufa` interoperability.
2. `docs/design-docs/db/db-architecture.md` is the storage contract for
   ordering, duplicate semantics, reopen behavior, and serialization.
3. The remaining DB story is no longer "missing broad surface area." It is
   promotion of the highest-value `Partial` rows with real parity evidence,
   especially `fetchTsgs` and the remaining `Komer` family.
4. Exact interop rules matter: keep `lmdb` pinned to `3.4.4`, preserve
   `LMDB_DATA_V1=true`, and route protocol/storage CBOR through the shared CESR
   codec.
5. Typed `Suber` / `Komer` wrappers are the active parity path; the forward
   ordinal-wrapper surface is the newer `getTop*` / `getAll*` family, with old
   `getOn*` names retained only as temporary compatibility aliases.
6. Record-model parity is `FooRecord` plus `FooRecordShape`, with `recordClass`
   as the durable public seam. Public `*Like` aliases and exposed
   `hydrate`/`normalize` hooks are drift.
7. Durable local identifier state is DB-backed: `states.` is authoritative,
   `kels.` / `fels.` / `dtss.` preserve reopenable event state, and
   `Habery.habs` is only a reconstructed in-memory cache.
8. Local key-management stays primitive-first: `Manager`, `Signator`, and keeper
   encryption should consume and return CESR primitives directly.
9. Parser-to-runtime dispatch is a first-class seam. Keep KERIpy family names
   such as `tsgs`, `trqs`, and `ssgs`, but do not create unnecessary local
   wrapper taxonomies around them.
10. Fixed-field seal/blind/media values belong to CESR structing records.
    Runtime code should project through `SealEvent.fromSad(...)`,
    `SerderKERI.eventSeals`, and related helpers rather than rechecking raw
    `{ i, s, d }` shapes everywhere.
11. Ordinal-bearing dispatch material currently needs
    `DispatchOrdinal = Seqner | NumberPrimitive`; forcing all ordinals into
    `Seqner` is false parity.
12. KEL control flow should stay TypeScript-native: normal outcomes are typed
    decisions, `Kever` decides validity, and `Kevery` owns routing, escrow
    persistence, duplicate handling, and post-acceptance side effects.
13. `docs/adr/adr-0005-kel-decision-control-flow.md` is the normative contract
    for that split.
14. Accepted identifier state belongs on `Kever` / `Baser`, not ad hoc habitat
    projections. Local inception and interaction should flow through the same
    `Kevery` acceptance path used for remote processing.
15. Weighted threshold parity is end to end through `Tholder`, including
    structured `kt` / `nt` payloads and `tholder.satisfy(...)`.
16. Cue ownership is dual-scope and explicit: runtime-hosted work uses the
    shared runtime cue deck, while `Habery.kevery` owns a separate local cue
    deck for habitat-local processing.
17. `Hab.processCuesIter()` remains the cue-semantics seam. `Revery` owns reply
    verification/BADA/escrows, `Kevery` owns KEL and `/ksn`-style reply
    families, and `Oobiery` owns introduction-driven OOBI behavior.
18. Local location state must arrive through signed `/loc/scheme` replies that
    flow back through `Revery`, not by direct writes to `locs.` / `lans.`.
19. Runtime turns should stay Effection-native; promise adaptation belongs only
    at real host edges.
20. Gates B, C, and D are established foundations. Gate E is materially real:
    shared runtime, mailbox/OOBI/query/receipt slices, bounded init/incept
    convergence, and the main query/reply correspondence closure are landed.
21. Incomplete `query` cues are runtime correspondence requests, not near-wire
    messages. They must resolve a local habitat and an honest remote attester
    before emitting follow-on `qry`.
22. Query acceptance for `logs` / `ksn` / `mbx` must use durable read-through
    state via `db.getKever(...)`, not only the hot `db.kevers` cache, or
    reopened witnesses will falsely escrow remote accepted subjects as
    `missingKever` and fail to emit `/replay` or `/reply`.
23. Delegator-side `delegate confirm` parity is `delegables`-driven, not
    notice-driven. Notices from `/delegate/request` are UI hints only; confirm
    must derive the delegated event, delegator, and approval order from
    `db.delegables`, then avoid pinning local `aess` or forcing delegated
    unescrow until the delegate event has been observed as locally committed
    through the witness-backed confirm path.
24. Cross-implementation delegation coverage now proves single-key and 2-of-2
    multi-key threshold `dip` + `drt` in both Tufa->KERIpy and KERIpy->Tufa
    directions. Protocol-level true group delegation is also proved both ways:
    real KERIpy two-member `GroupHab` delegated inception can be approved by
    Tufa and completed in KERIpy, and a Tufa-generated two-member delegated
    group inception can be approved by KERIpy and completed in Tufa. Tufa-only
    true group delegation coverage now proves single->2-of-2 group, 2-of-2
    group->single, 2-of-2 group->2-of-2 group, and witnessed 2-of-3
    group->witnessed 2-of-3 group approval. Tufa now has public CLI multisig
    `incept`, `join`, `interact`, and `rotate` surfaces over the real
    grouping/multiplexing path; interop workflows should use those CLI seams
    instead of private `Habery.makeGroupHab(...)` shortcuts.
25. Delegation source-seal repair has two cases. Pending delegated events in
    `pdes` / `delegables` still use explicit delegation escrow promotion, but
    already accepted local delegated events must also pin `aess` when a later
    accepted delegator event replays an anchor seal in `a`. Without that repair,
    single delegated AIDs that accepted locally before the delegator replay can
    have a valid Kever without durable authorizing seal state. KEL membership is
    also not sufficient to classify an event as a duplicate when `states.` is
    behind that sequence number; replay must repair current state before
    duplicate handling can short-circuit.
26. The remaining runtime gaps are narrower now: broader exchange/forwarding
    route breadth, the stale/timeout continuation tail, and the last high-value
    DB parity promotions.
27. Gate F/G bridge work is already partly real: `Exchanger` owns accepted and
    partially signed `exn` persistence, challenge flows are live, and mailbox
    forwarding/polling now sit on explicit shared provider storage plus durable
    `tops.` cursors.
28. The mailbox mental model must stay explicit: provider mailbox storage is
    shared runtime-composed state above `Habery`, while remote topic cursors are
    durable habery state in `tops.`.
29. `tufa agent` has two independent compatibility seams: CLI flag semantics and
    packaged Node runtime behavior. Release confidence requires smoke coverage
    against the packed artifact, not just Deno source runs.
30. Honest CLI/bootstrap tests must use explicit file-path flags such as
    `--config-dir` / `--config-file` rather than hidden default-path mutation.
31. End-to-end controller-to-controller coverage must respect single-store
    ownership. Do not run CLI commands against the same store a live
    `tufa agent` is currently hosting; a stale live runtime can overwrite
    newer command-local accepted state.
32. `tufa db dump` is now a first-class interop-debugging seam; prefer targeted
    selectors over ad hoc LMDB scripts or whole-store dumps.
33. The host mental model is one listener/runtime per Habery or command
    invocation with explicit hosted-prefix filtering. A multi-AID bug is a
    selection/bootstrap bug, not one-listener-per-AID topology.
34. AEID is keeper auth/encryption state, not an ordinary hosted or user-facing
    AID. Treat signatory/AEID-related identities as non-user-facing by default.
35. Endpoint-role capability and startup seeding are separate concerns. The
    presence of `Roles.agent` in protocol code is not, by itself, a reason to
    auto-create self `agent` roles at startup.
36. Alias-scoped config `dt` + `curls` is the canonical controller endpoint
    bootstrap path; localhost synthesis is a fallback only when config and
    accepted endpoint state are both missing.
37. `MailboxPoller` now has an honest finite/infinite split: bounded
    `processOnce()` returns typed batches, while long-lived `pollDo()` stays
    sink-based for concurrent workers.
38. `packages/tufa` owns the runnable host/CLI edge. `packages/keri` remains a
    library/runtime surface, not the home of host composition, command
    registration, or transport middleware policy.
39. Attachment counter genus-version handling is split by message class: live
    message serialization may follow caller/requested `gvrsn` and KERIpy v2
    enclosure rules, but replay clone APIs (`Baser.clone*`, `Reger.cloneTvt*`,
    KEL/TEL replay helpers) are fixed to v1 counters because they replay stored
    KEL/TEL events rather than constructing new live attachment envelopes.

## Use This Doc For

1. Event validation and ordering rules
2. Replay/unescrow behavior and accepted-state ownership
3. DB parity, runtime architecture, and KERIpy interop nuances

## Key Docs

1. `docs/design-docs/db/db-architecture.md`
2. `docs/adr/adr-0005-kel-decision-control-flow.md`
3. `docs/adr/adr-0008-escrow-decision-architecture.md`
4. `docs/design-docs/keri/CUE_ARCHITECTURE_CROSS_RUNTIME.md`
5. `docs/design-docs/keri/MAILBOX_ARCHITECTURE_ACROSS_KERIPY_AND_KERI_TS.md`
6. `docs/design-docs/keri/QUERY_REPLY_CORRESPONDENCE_AND_WATCHER_SUPPORT.md`
7. `docs/design-docs/keri/DELEGATION_MULTISIG_ENDPOINT_ROLES_MAINTAINER_GUIDE.md`
8. `docs/design-docs/keri/ATTACHMENT_COUNTER_GVRSN_MAINTAINER_GUIDE.md`

## Current Follow-Ups

1. Keep KEL-state work parity-first on top of DB invariants rather than adding
   abstraction before behavior closure.
2. Continue the remaining Gate E / Gate F bridge with focus on broader
   exchange/forwarding route breadth and stale/timeout continuation behavior.
3. Promote high-value DB `Partial` rows with row-level evidence instead of
   symbol-existence optimism.
4. Keep cue/query/watcher/escrow docs current when behavior changes; drift in
   those contracts is a real regression.
5. Keep `tufa agent` smoke coverage honest at the packaged boundary.
6. Keep Gate E end-to-end coverage CLI-first and store-ownership-honest.
7. Keep host-prefix selection explicit and conservative when touching `agent`,
   `mailbox start`, or server route filtering.
8. When interop behavior seems ambiguous, compare targeted DB state before and
   after the operation with `tufa db dump` before inventing a new explanation.
9. Keep `packages/tufa` ownership hard: runnable CLI, role-host composition, and
   HTTP middleware policy stay there.
10. Compact this doc again when it starts reading like an archive.

## Milestone Rollup

### 2026-03-02 to 2026-03-18 - DB Foundation And Local-State Truth Landed

- The DB parity matrix and wrapper surface became real enough to support later
- runtime and interop work.
- Local identifier state moved onto the DB backbone instead of process-local
  habitat projections.

### 2026-03-27 to 2026-04-04 - Runtime Ownership And Typed Control Flow Sharpened

- Runtime architecture locked around explicit parser-to-runtime dispatch, the
  shared runtime cue deck, and `Habery`-local `Kevery` ownership for local
  acceptance.
- `Kever`/`Kevery` split, threshold semantics, live receipt-family handling, and
  replay/unescrow decisions moved onto clearer typed seams.
- CESR structing records became the semantic home for fixed-field seal/blind
  data, with KERI tuple aliases remaining derived storage views.

### 2026-04-05 to 2026-04-06 - Query, Mailbox, And Exchange Boundaries Became Honest

- `QueryCoordinator` now owns incomplete query correspondence rather than
  smuggling that policy into cue interpretation.
- Replay-attached receipt handling and query replay parity closed the real Chunk
  8 gap.
- Mailbox ownership is now explicit: shared provider-side mailbox storage above
  `Habery`, durable remote cursors in `tops.`, and `MailboxDirector`/poller
  layers above both.

### 2026-04-07 to 2026-04-09 - Host, Package, And Release Surfaces Tightened

- `tufa agent` parity now treats source-vs-npm drift as a real release risk.
- Hosted-prefix filtering, mailbox/witness role hosting, and protocol routing
  were split onto clearer host/runtime/package ownership lines.
- `packages/tufa` is now the runnable CLI/host boundary, while `keri-ts` exposes
  the narrow library surface.
- AEID and other system-managed identities were clarified as keeper/system state
  rather than ordinary user-facing hosted identities.

### 2026-06-05 - Cross-Implementation Delegation Boundary Proven

- Tufa/KERIpy delegation interop now has executable `dip` + `drt` coverage in
  both directions for single-key and 2-of-2 multi-key threshold delegated AIDs.
- KERIpy delegated events for a local Tufa delegator must route into
  `delegables` until the local delegator approves; remote-protected shortcuts
  must not bypass that local approval gate.
- True group delegation is proved at the protocol boundary in both directions:
  KERIpy `GroupHab` -> Tufa approval -> KERIpy completion, and Tufa-generated
  two-member group `dip` -> KERIpy approval -> Tufa completion.
  `Habery.makeGroupHab(...)` now provides the Tufa production inception surface
  used by that test; full Counselor/Multiplexor coordination and group rotation
  remain unimplemented.
- Group habitat metadata must be persisted before processing so pending
  delegated group records survive reopen, but `db.prefixes` / `db.groups` must
  be marked only after actual acceptance. Marking them before validation turns
  the event into a protected-party case and can incorrectly bypass remote
  delegator proof.
- Tufa-only true group delegation now has an executable matrix for
  single->2-of-2 group, 2-of-2 group->single, 2-of-2 group->2-of-2 group, and
  witnessed 2-of-3 group->witnessed 2-of-3 group approval. The witnessed case
  must preserve `WitnessIdxSigs` in both the pre-approval delegated event
  payload and the delegator approval replay.
- Accepted delegator anchor replay must repair missing `aess` for already
  accepted delegated events, not only promote events still sitting in delegation
  escrows.
- `delegate confirm` now mirrors KERIpy's source-of-truth shape: scan
  `delegables`, anchor the local delegator event, wait for normal
  query/replay-backed delegated commitment, then pin `aess` and unescrow.
  `/delegate/request` notices remain operator/UI hints and must not route
  approval or replay publication.
- Replaying a stored delegated event must not treat `kels.` membership alone as
  a duplicate when durable `states.` still trails the event sequence number.
  In that condition, replay repairs state before duplicate handling is allowed
  to short-circuit.
- KLI/Tufa interop harnesses must not keep a live `tufa agent` open for the
  same store that command-local Tufa CLI confirmation is mutating. Use witnessed
  mailbox/OOBI transport for the cross-implementation workflow instead of a
  same-store direct Tufa host.

### 2026-06-08 - Public Multisig CLI Boundary Landed

- Tufa group workflows now have public `tufa multisig incept`, `join`,
  `interact`, and `rotate` commands. Tests and seed workflows should mirror KLI
  by using `tufa multisig join` for Tufa-generated group AIDs instead of
  invoking internal group habitat APIs.
- Delegated group inception must keep the delegator proof explicit: create the
  delegated group event with `delpre`, anchor it from the delegator, then query
  the delegator KEL with the delegated event anchor and assert the delegate's
  stored delegator field.
