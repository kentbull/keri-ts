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
    `frcs`, `sscs`, `ssts`, and related families), but do not give every family
    a local wrapper taxonomy: receipt groups can stay named dispatch objects,
    while fixed-field seal/blind/media families should use CESR structing
    records directly.
14. KEL/runtime code that cares about anchor semantics should project through
    CESR structing helpers (`SealEvent.fromSad`, `SerderKERI.eventSeals`, and
    related record helpers) instead of repeating raw `{ i, s, d }` shape checks
    in each subsystem.
15. Ordinal-bearing dispatch material currently needs
    `DispatchOrdinal = Seqner | NumberPrimitive`; forcing everything into
    `Seqner` is false parity because it ignores what the current parser actually
    emits.
16. KEL control flow should stay TypeScript-native: normal outcomes are typed
    decisions (`accept`, `duplicate`, `escrow`, `reject`), `Kever` decides
    state-machine validity, and `Kevery` owns routing, escrow persistence,
    duplicate handling, and post-acceptance side effects.
17. `docs/adr/adr-0005-kel-decision-control-flow.md` is the normative contract
    for that state-machine/orchestrator split and should guide future
    `Tever`/`Tevery`-style ports as well.
18. Accepted identifier state should live on `Kever` / `Baser`, not on ad hoc
    habitat projections. Local inception needs to flow through the same `Kevery`
    acceptance path used for remote processing.
19. Weighted threshold parity is end to end: `Tholder` owns threshold semantics,
    structured `kt` / `nt` payloads are allowed in serder/state storage, and
    both `Kever` and `Revery` should rely on `tholder.satisfy(...)` instead of
    numeric shortcuts.
20. Cue ownership is dual-scope, matching KERIpy more honestly than an
    "everything hangs off AgentRuntime" story. `AgentRuntime` holds the shared
    runtime cue deck for runtime-hosted processing, while `Habery.kevery` owns a
    separate local cue deck for `Hab` local event/receipt acceptance.
21. `Hab.processCuesIter()` remains the cue-semantics seam across both scopes,
    and runtime delivery happens through `processCuesOnce()` / `cueDo()`
    yielding structured `CueEmission` values.
22. The maintainer-facing end-to-end explainer for this architecture is now
    `docs/design-docs/keri/CUE_ARCHITECTURE_CROSS_RUNTIME.md`. Keep
    `docs/adr/adr-0004-cue-runtime-portability.md` normative for `keri-ts`
    semantics, and keep mailbox/query docs narrower by linking back to the new
    explainer instead of reteaching the entire cue system in fragments.
23. Reply/runtime ownership is also explicit: `Revery` verifies, BADA-checks,
    and escrows reply traffic; `Kevery` owns KEL and KEL-derived reply families
    such as `/ksn`; `Oobiery` owns introduction-driven OOBI behavior.
24. Local location-scheme state must arrive through signed `/loc/scheme` replies
    parsed back through `Revery`, not by direct writes to `locs.` / `lans.`.
25. Runtime turns should stay Effection-native. Promise adaptation belongs only
    at real host edges such as `fetch()`, dynamic import, or server-finished
    handles.
26. Gates B, C, and D are established enough to stop debating bootstrap
    viability: local visibility, compat-store visibility, and encrypted keeper
    semantics are real foundations now.
27. Gate E now has a real shared runtime, mailbox/OOBI/query/receipt slice,
    bounded init/incept convergence, and the broader Chunk 7 query/reply
    correspondence closure: `/watcher/{aid}/{action}`, stricter `/ksn`
    trust-source parity, runtime `QueryCoordinator`, and query-continuation
    pending-state tracking are all landed.
28. Incomplete `query` cues are not near-wire messages. They are runtime
    correspondence requests that must resolve a local habitat and an honest
    remote attester before emitting a follow-on `qry`.
29. The remaining gaps are narrower and clearer now: promote key DB `Partial`
    rows, finish broader exchange/forwarding route breadth beyond the now-proven
    mailbox `/challenge` slice, and harden the broader stale/timeout
    continuation tail rather than reopening the old query/reply or receipt/query
    correspondence graph.
30. The first Gate F/G bridge is now real in `keri-ts`: `Exchanger` owns
    accepted and partially signed `exn` persistence (`exns.`, `epse.`, `epsd.`,
    `esigs.`, `ecigs.`, `epath.`, `essrs.`, `erpy.`), challenge responses land
    through `/challenge/response`, and the CLI now has `exchange send`,
    `exn send`, plus `challenge generate/respond/verify`.
31. Mailbox ownership is now closer to KERIpy's real architecture: mailbox
    storage is shared provider-side state composed by runtime/host layers above
    `Habery`, while remote topic cursors remain durable habery state in `tops.`.
    `/fwd` forwarding publishes into that shared store, and runtime polling
    advances durable `(pre, witness)` `tops.` cursors rather than ad hoc
    per-command maps. Mailbox add interop is now proven in both directions too,
    so the remaining Gate F/G gap is broader route breadth, not mailbox
    ownership or add/list/debug lifecycle absence.
32. The maintainer-facing mailbox explainer now lives in
    `docs/design-docs/keri/MAILBOX_ARCHITECTURE_ACROSS_KERIPY_AND_KERI_TS.md`.
    Use it to rehydrate the sender/recipient/mailbox-provider split,
    recipient-to-mailbox authorization, `/fwd` as provider transport wrapper,
    mailbox polling through `mbx`, and the fact that `POST /mailboxes` manages a
    controller's authorization of one already-hosted mailbox AID instead of
    creating mailbox identities on demand.
33. The maintainer contract for the Chunk 7 query/watcher slice now lives in
    `docs/design-docs/keri/QUERY_REPLY_CORRESPONDENCE_AND_WATCHER_SUPPORT.md`,
    and the broader escrow-control philosophy now lives in
    `docs/adr/adr-0008-escrow-decision-architecture.md`. Treat those as the
    durable sources before relying on thread history.
34. `tufa agent` has two independent compatibility seams: CLI flag semantics and
    the packaged Node host runtime. Deno-source tests can prove runtime
    behavior, but release confidence also needs tarball smoke coverage because
    the npm build can drift into stale command definitions or Node-incompatible
    server code.
35. Config-seeded bootstrap should stay on explicit CLI/file seams, not hidden
    default-path tricks in tests. If a command needs external bootstrap config,
    give it `--config-dir` / `--config-file` or another honest file input
    surface; do not have bash E2E scripts write directly into the command's
    default internal config location and pretend that proves CLI behavior.
36. Gate E/G bash coverage now includes `challenge generate/respond/verify`
    across direct and mailbox-authorized controller-to-controller delivery, but
    the honest test seam is single-store ownership: do not run a CLI command
    against the same keystore/database that a live `tufa agent` is already
    hosting. Stop the sender host, run the sender CLI, and keep only the
    recipient host live for receive-side runtime coverage.
37. Interop debugging is materially easier and more honest through targeted
    `tufa db dump` inspection than through ad hoc LMDB scripts. Prefer narrow
    selectors such as `baser.<subdb>`, `mailboxer.<subdb>`, and
    `outboxer.<subdb>` against both `.tufa` and `.keri` stores when validating
    mailbox add/list/debug flows, `/fwd` storage, or cross-runtime state drift.
38. The long-lived host mental model is one listener/runtime per Habery or
    command invocation with explicit hosted-prefix filtering. A bug in multi-AID
    seeding means the host is bootstrapping or exposing too many local Habs, not
    that it is creating one socket/listener per AID.
39. System-managed identities need a stricter filter than `hby.habs.values()`.
    Signatory or AEID-related identities may live in the local keystore, but
    they are not ordinary user-facing controller/mailbox identities and should
    not be auto-hosted, auto-seeded, or exposed through normal OOBI/mailbox
    surfaces by default.
40. AEID in KERIpy is not an init-only ornament. `Habery.setup(...)` and
    `Manager.updateAeid(...)` treat it as the keeper auth/encryption identity,
    and changing it with the matching seed re-encrypts keeper secrets. Model it
    as system-side keeper state, not as a normal user Hab.
41. Keep endpoint-role capability separate from startup seeding policy. The
    presence of `Roles.agent` in routing/query/OOBI code is not by itself a
    reason for `tufa agent` to auto-create self `agent` end-role records at
    startup. Until a distinct agent runtime construct needs that self state,
    startup should seed only the roles that are operationally required.
42. Controller endpoint bootstrap now has a KERIpy-shaped canonical path too:
    alias-scoped config `dt` + `curls` are applied by `Hab.reconfigure()`
    through normal `/end/role/add` and `/loc/scheme` reply acceptance, while
    `runIndirectHost` is host wiring only. `tufa agent` may synthesize localhost
    controller state only as a last-resort fallback when no alias config exists
    and accepted controller endpoint state is otherwise missing.

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
7. `docs/design-docs/keri/QUERY_REPLY_CORRESPONDENCE_AND_WATCHER_SUPPORT.md`
8. `docs/adr/adr-0008-escrow-decision-architecture.md`

## Current Follow-Ups

1. Keep KEL-state work parity-first on top of DB invariants rather than adding
   abstraction before behavior closure.
2. Continue the Gate E continuation / Gate F bridge with focus on broader
   exchange/forwarding route breadth, KERIpy interop evidence, and stale/timeout
   continuation behavior now that runtime-composed shared mailbox storage,
   habery-owned remote mailbox cursors, and the broader query/reply
   correspondence slice are landed.
3. Promote high-value DB `Partial` rows with real row-level evidence instead of
   symbol-existence optimism.
4. Keep the new maintainer docs current when query/watcher or escrow-decision
   behavior changes; docs drift here is a real regression. Treat
   `docs/design-docs/keri/CUE_ARCHITECTURE_CROSS_RUNTIME.md` as the primary
   explainer when cue ownership or host wiring changes.
5. Keep DB/runtime worklists concise and execution-oriented; when the docs start
   reading like archives again, compact them.
6. Keep `tufa agent` smoke coverage honest at the packaged boundary. Help text
   alone is not enough; the tarball path should prove real host startup.
7. Keep Gate E E2E coverage CLI-first: plain JSON config files and protocol
   routes are fair game, arbitrary `deno eval` LMDB inspection or default-path
   config seeding are not. For exchange/challenge flows, keep host lifecycles
   explicit so the script does not smuggle in concurrent single-store access as
   an accidental dependency.
8. Keep host-prefix selection work explicit. When touching `agent`,
   `mailbox start`, or server route filtering, reason from "which local
   identities are intentionally hostable" rather than "which Habs exist."
9. When interop behavior seems ambiguous, compare targeted DB state before and
   after the operation with `tufa db dump` on both the `tufa` and KERIpy
   keystores before inventing new explanations.

### 2026-04-06 - Host Selection And AEID Mental Models Needed Sharpening

- `tufa agent` was never starting one HTTP listener per local AID. The bug class
  was over-broad multi-AID bootstrap and hosted-prefix selection inside one
  shared host/runtime.
- `tufa mailbox start` exists because mailbox hosting needs explicit identity
  ownership, not because mailboxes need a different server topology. One host
  can serve multiple local identities when that is intentional, but the
  selection filter must be explicit and conservative.
- AEID should be treated like KERIpy treats it: a keeper auth/encryption
  identity that may be user-specified at init and later changed to re-encrypt
  secrets, but not a normal user-facing controller/mailbox identity.
- For interop debugging, targeted `tufa db dump` inspection is now the fastest
  route to truth. Whole-store dumps and ad hoc LMDB scripts add noise when the
  real question is usually one subdb transition.

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

### 2026-04-04 - KEL Runtime Adopted CESR Structing Records

- `KeriDispatchEnvelope` now uses CESR `SealSource`, `SealEvent`, `SealKind`,
  `BlindState`, `BoundState`, and `TypeMedia` records directly instead of a
  second `packages/keri` wrapper-class family.
- `SerderKERI` stays raw-SAD-first for `a`/`seals`, but KEL/runtime consumers
  now project typed anchors through `sealRecords` / `eventSeals` and
  `SealEvent.fromSad(...)` instead of repeating raw `{ i, s, d }` checks.
- `Baser` storage tuple aliases remain tuple-shaped for LMDB parity, but they
  are now derived from CESR structing descriptors so the semantic source of
  truth lives in one place.

### 2026-04-05 - Query/Reply Correspondence Moved To A Runtime Coordinator

- `QueryCoordinator` now owns the KERIpy-style correspondence step between
  incomplete `query` cues and honest outbound `qry` messages.
  `Hab.processCuesIter()` stays a cue-to-wire interpreter for already-complete
  cues instead of growing endpoint-selection policy.
- `Kevery` reply parity widened to cover `/watcher/{aid}/{action}` plus tighter
  non-lax `/ksn` trust-source rules: only self, one of the reported KSN backers,
  or a locally configured watcher can authoritatively advance saved key state.
- Runtime convergence must treat active query continuations as pending work.
  Otherwise `init` / `incept` can terminate while the correspondence layer still
  owes a follow-on `logs` query or local catch-up wait.

### 2026-04-05 - Receipt And Query Replay Parity Closed The Real Chunk 8 Gap

- The real missing parity was not the basic `UWE` / `URE` / `VRE` / `QNF` family
  existence. It was the replay-attached receipt path. `Reactor` now dispatches
  cloned KEL event attachments into dedicated
  `Kevery.processAttachedReceiptCouples(...)` and
  `processAttachedReceiptQuadruples(...)` seams, and `Kevery` now mirrors
  KERIpy's `escrowTRQuadruple(...)` behavior for attached transferable receipt
  replay.
- Transferable query ingress now follows KERIpy's attachment family split
  honestly: `Hab.query(...)` emits `TransLastIdxSigGroups`, `Reactor`
  reconstructs requester identity from the last `ssgs` group, and durable `QNF`
  replay still intentionally stays scoped to stored `sigs.` plus
  non-transferable `rcts.` because KERIpy itself still leaves transferable
  query-endorsement replay as a TODO.
- `TimeoutQNF` now matches KERIpy's 300-second policy. The remaining timeout
  work is no longer "make QNF honest"; it is the broader stale/continuation
  behavior across later runtime/comms flows.

### 2026-04-05 - `tufa agent` Must Stay Aligned Across Source And npm

- `tufa agent` now treats `-p` as port and `-P` as passcode so the command
  matches operator expectation while preserving long `--passcode`.
- The HTTP host boundary now has a small runtime adapter: Deno source still uses
  `Deno.serve`, while npm/Node builds fall back to `node:http` instead of
  crashing on `dntShim.Deno.serve`.
- The durable lesson is release-process, not just code-path: the packed npm
  tarball needs smoke coverage through `init -> incept -> agent -> /health` or
  source/package drift will recur silently.

### 2026-04-05 - Exchange And Challenge Moved From Missing Surface To First-Class Runtime Slice

- `Exchanger` now owns accepted and partial-signature `exn` verification,
  persistence, and replay through the dedicated exchange stores instead of
  leaving the DB rows idle.
- The first route-level exchange behavior is live: `/challenge/response`
  persists accepted responses into `reps.`, `challenge verify` promotes matched
  responses into `chas.`, and the CLI now exposes
  `challenge generate/respond/verify` plus `exchange send` and the `exn send`
  alias.
- The important mailbox boundary is now explicit: provider mailbox topic storage
  is shared runtime-composed state scoped to one habery environment, while
  remote cursor progress remains durable habery state in `tops.`. Runtime
  `MailboxDirector` / poller layers sit on top of those two stores. Do not fall
  back to per-command mailbox maps, per-hab mailbox ownership, or `Habery`-owned
  mailbox sidecars.
- The remaining Gate F/G work is broader exchange-route breadth and KERIpy
  interop proof, not rediscovering mailbox ownership.

### 2026-04-05 - Mailbox Add/Remove Uses Accepted End-Role State As The Authority

- `keri-ts` now has a dedicated LMDB `Mailboxer` plus a dedicated LMDB
  `Outboxer`. That split matters: provider-side stored inbound messages and
  sender-side mailbox retry are different state machines and should not share a
  fake "mailbox queue" abstraction.
- The long-lived host now exposes `POST /mailboxes` and verifies mailbox
  authorization against signed `/end/role/add` and `/end/role/cut` replies
  targeted at the hosted mailbox AID. Accepted `ends.` state is both protocol
  truth and runtime authorization.
- Forwarded `/fwd` payloads are no longer blindly stored. They are only written
  to mailbox storage when the active request path identifies a hosted mailbox
  AID and accepted state currently allows `[recipient, mailbox, hostedAid]`.
- The local `tufa mailbox add/remove/list/update/debug` surface is now landed
  and covered with focused tests. The honest remaining work is interop, not
  rediscovering the mailbox lifecycle model again.

### 2026-04-06 - Runtime Composition Now Owns Provider Mailbox Storage

- `Habery` no longer reopens or closes `Mailboxer`. That dependency direction
  was the architectural smell; the mailbox depends on habery state, not the
  other way around.
- `createAgentRuntime()` is now the default composition root for provider
  mailbox storage. Indirect/mailbox-capable runtimes auto-open a mailboxer,
  while generic local runtimes stay mailbox-store-free unless explicitly opted
  in.
- `MailboxDirector` and `Poster` now require explicit mailbox-store injection
  for provider-side publish/store behavior. When that store is absent, provider
  actions fail fast instead of silently rediscovering mailbox state through
  `Habery`.

### 2026-04-06 - Mailbox Interop Needed Wire-Parity Discipline More Than New Stores

- The real mailbox interop bug was not "missing more mailbox DB state." It was
  wire-shape drift. KERIpy mailbox HTTP expects one CESR message per request,
  with only that message's attachments in `CESR-ATTACHMENT`. Header-mode
  multi-message delivery must split streams per message; sending a whole CESR
  stream behind one attachment header is false parity.
- `/fwd` interoperability now passes both ways because the embedded exchange
  payload path is live end to end: KERIpy-backed provider state now shows both
  accepted `epath` rows and persisted `Mailboxer` topic/message entries for
  mailbox-delivered `/challenge` traffic instead of accepting only the outer
  EXN.
- Base-path-relative mailbox serving is now part of the proven contract, not a
  deferred idea. The live interop path exercises mailbox/admin/OOBI hosting at
  `http://host/<aid>/...`, and generated mailbox OOBIs must resolve relative to
  that advertised base path.
- `challenge verify` parity is mailbox-driven first and DB matching second. The
  useful mental model is KERIpy's `MailboxDirector(topics=['/challenge'])` loop:
  poll mailboxes until challenge responses land through `Exchanger`, then match
  accepted responses in `reps.` / `exns.`.
- KERIpy's checked-in CLI gives real interop evidence for `mailbox add`,
  `mailbox list`, `mailbox update`, and `mailbox debug`, but not a native
  `mailbox remove` surface. Keep remove as a local `tufa` feature, but do not
  pretend it is part of the current KLI interop bar.

### 2026-04-06 - Mailbox Start Is A Host-Ownership Porcelain, Not A New Runtime

- `tufa mailbox start` is now the right high-level operator seam for running a
  single mailbox, but the important mental model is that it reuses the existing
  indirect-mode runtime and HTTP server. The new work is in startup/reconcile
  policy and hosted-prefix filtering, not in inventing a mailbox-only host.
- The command should be able to create a new keystore/AID when missing, but it
  must also be able to reopen an existing mailbox alias and serve only that
  prefix from a multi-AID habery. "Only this hosted prefix answers OOBI/admin
  routes" is the durable invariant.
- Existing accepted local state is a valid startup source when it is complete.
  The command should fail rather than guess when mailbox bootstrap material is
  incomplete and no authoritative `url` + `dt` input was provided.
- Base-path hosting is part of the mailbox-start contract. For a mailbox
  advertised at `http://host/base`, the host must serve `http://host/base/oobi`
  and `http://host/base/mailboxes`; it should not rely on the looser
  multi-prefix `agent` behavior.
- Current testing caveat: mailbox-start local lifecycle coverage is in place,
  but subprocess-driven integration can still be obscured by a Deno 2.7.10
  child-process panic (`Cannot remove cleanup hook which was not registered`).
  That needs to be separated from actual mailbox-start regressions when judging
  interop failures.

### 2026-04-07 - KERIpy Mailbox Query Replies Depend On Shared Cue Wiring

- The reverse-interop failure after switching to real KERIpy `kli mailbox start`
  was not a Tufa mailbox-store or authorization bug. Forwarded `/challenge`
  traffic was landing in KERIpy `.keri/mbx`, but `challenge verify` still failed
  because mailbox queries never received a response.
- The real bug was in KERIpy host composition: `setupMailbox(...)` created the
  shared cue deck for `Kevery` / `Revery`, but it did not pass that deck into
  `MailboxStart`. As a result, `MailboxStart.cueDo()` watched an empty private
  deck, so `stream` cues never reached `HttpEnd.qrycues` and `mbx` HTTP queries
  hung.
- Durable rule: for witness/mailbox-style hosts, the doer that routes cues to
  HTTP/query responders must observe the exact shared cue deck used by parser
  ingress processors. "Same runtime pieces" is not enough if the shared deck is
  accidentally forked.

### 2026-04-07 - Mailbox Polling Timeout Policy Must Be Split By Responsibility

- The real KERIpy parity seam for mailbox polling is `indirecting.Poller`, not
  `HttpEnd.TimeoutMBX = 5`. In practice that means `keri-ts` mailbox polling
  should treat request-open timeout, long-poll read duration, and bounded
  command-local polling budget as different policies instead of one magic
  number.
- `MailboxPoller` is now the TS-native port of KERIpy `Poller`, while
  `MailboxDirector` stays the topic/cursor/query-cue coordinator. That class
  split was the right port shape; the important correction was behavior, not a
  collapse back into one monolith.
- Durable timeout policy:
  - request-open timeout: short, internal transport guard (`5s` default)
  - long-poll read duration: KERIpy-shaped mailbox wait window (`30s` default)
  - command-local polling budget: bounded helper/CLI turn budget (`5s` default)
- Long-lived runtime polling now behaves more like KERIpy again: keep one
  concurrent remote polling worker per `(pre, endpoint)` instead of serializing
  all remote mailboxes through one `processOnce()` loop. Bounded command-local
  helpers still stay sequential and budgeted on purpose.

### 2026-04-03 - DB Audit And Record-Model Cleanup Closed The Old Missing-Surface Story

- Re-audited the DB parity matrix against current source.
- Landed the earlier five missing rows (`RawRecord`, `OobiQueryRecord`,
  `DupKomer`, `BaserDoer`, `Broker`) and reframed the real next step as
  evidence-driven `Partial` promotion.
- Tightened the public mapper API around `recordClass` plus `FooRecord` /
  `FooRecordShape` and removed the old `*Like` naming drift.
