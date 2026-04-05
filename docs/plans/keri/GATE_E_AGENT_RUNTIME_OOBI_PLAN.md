# Gate E Plan: Cue-Driven AgentRuntime for Endpoint Auth and OOBI Bootstrap

## Summary

- Define `AgentRuntime` as a shared bundle of long-running Effection operations,
  matching the role that KERIpy's doer sets play under `runController`, not as a
  daemon-only concept.
- Host that same runtime in two ways: command-local inside CLI commands and
  long-lived inside `tufa agent`.
- Do not add any local CLI-to-agent HTTP admin API in Gate E. Local mutation of
  DB and keystore state stays in local CLI commands only.
- Keep the runtime flow-based and cue-driven. A `Deck`-equivalent double-ended
  queue abstraction and KERIpy-style cues are non-negotiable for this pass.
- Run escrows continuously on every scheduler turn, KERIpy-style, not on a
  timer.
- Require the BADA-RUN subset needed for bootstrap reply handling in Gate E.
- Minimum Gate E outcome is:
  - add mailbox endpoint role auth
  - add local `loc add` parity for accepted `LocationScheme` records
  - generate controller, witness, mailbox, and agent OOBIs where local state
    permits
  - resolve mailbox, controller, witness, and agent bootstrap OOBIs
  - resolve config-seeded bootstrap URLs from both `oobis.` and `woobi.`
  - route all fetched bootstrap artifacts through CESR parse -> dispatch ->
    escrow -> finalization
  - prove `tufa agent` stays protocol-only and that the bootstrap command slice
    has live KERIpy parity evidence

## Status Reconciliation (2026-04-05)

- Verdict: Gate E is now materially complete for the honest bootstrap/runtime
  slice. It is not "all runtime parity", but it no longer makes sense to treat
  bootstrap reply/query/receipt handling as the active blocker.
- Closed evidence in the repo now includes:
  - shared `AgentRuntime` hosting through both local commands and `tufa agent`
  - runtime-backed `tufa loc add`, `tufa ends add`, `tufa oobi generate`, and
    `tufa oobi resolve`
  - config preload feeding `oobis.` and `woobi.`, with `tufa init` and
    `tufa incept` now hosting bounded command-local runtime convergence instead
    of stopping at DB preload
  - protocol-only indirect host coverage for `tufa agent`, including OOBI /
    resource serving, mailbox SSE, and a local `/health` route
  - KEL-owned `/ksn/{aid}` and `/watcher/{aid}/{action}` reply handling,
    `Oobiery`-owned `/introduce`, and runtime `QueryCoordinator` handling for
    incomplete `query` cues
  - receipt/query replay closure for the real bootstrap-critical slice,
    including unverified receipt-family reprocessing, attached replay receipt
    handling, and transferable query ingress via `ssgs`
- Deferred beyond Gate E:
  - broader direct/mailbox/forwarding/exchange transport breadth
  - the broader stale/timeout continuation tail and richer cleanup/retry policy
  - data/TEL/credential OOBI breadth beyond the controller/witness/mailbox/agent
    bootstrap slice
  - packaged npm/tarball runtime confidence for `tufa agent`, which is now a
    release concern distinct from the source-path runtime design
- Planning rule: those deferred items still matter, but they are no longer Gate
  E exit criteria. They belong to Gate F and later runtime/comms hardening.

## Current Implementation Reality (2026-04-05)

Maintainer note:

- the durable maintainer docs for the Chunk 7 query/watcher slice now live in
  `docs/design-docs/keri/QUERY_REPLY_CORRESPONDENCE_AND_WATCHER_SUPPORT.md` and
  `docs/adr/adr-0008-escrow-decision-architecture.md`
- this plan remains the execution history and work-tracking view, not the
  primary long-term architecture reference

- Chunks 1 through 10 are now either materially complete for the honest Gate E
  slice or explicitly deferred beyond Gate E.
- Chunk 1 is materially complete: the shared `AgentRuntime` composition root,
  `Reactor`, `Oobiery`, `MailboxDirector`, `QueryCoordinator`, and the
  long-lived/local host split all exist.
- Chunk 2 is complete for the Gate E bootstrap slice: config preload seeds
  `oobis.` / `woobi.`, the shared runtime consumes both queues, and command-
  local hosts now wait for bounded convergence in `init` and `incept`.
- Chunk 3 is materially complete for active KERI runtime work: the dispatch
  envelope exists, normalized attachment families use KERIpy names, and current
  `ilk` dispatch is sufficient for KEL / reply / query / receipt bootstrap
  flows. EXN / TEL breadth is still later work, not a reason to reopen the seam.
- Chunk 4 is materially complete for the real reply-critical surface:
  `/end/role/*`, `/loc/scheme`, `/ksn/{aid}`, `/watcher/{aid}/{action}`, and
  `/introduce` are routed through their intended owners.
- Chunk 5 is materially complete for cue/runtime projection: `Hab`-owned cue
  semantics, mailbox `stream` capture, `logs` / `ksn` / `mbx` query routing,
  and `receipt` / `witness` wire materialization are all landed.
- Chunk 6 is materially complete for the indirect-host bootstrap slice: the
  server accepts CESR `POST` / `PUT`, serves mailbox SSE for `mbx`, serves OOBI
  resources from local reply/auth material, and remains protocol-only.
- Chunk 7 is materially complete for the broader query/reply correspondence
  slice: incomplete `query` cues flow through runtime `QueryCoordinator`,
  `/watcher/{aid}/{action}` is KEL-owned, `/ksn` trust-source parity is tighter,
  and runtime pending-state convergence includes active query continuations.
- Chunk 8 is materially complete for the KERIpy receipt/query parity slice:
  the unverified witness / non-transferable / transferable receipt escrows,
  KERIpy-aligned 300-second `query-not-found` retry policy, replay-attached
  receipt handling for cloned KEL events, and transferable query ingress via
  `ssgs` are all landed.
- Chunk 9 is materially complete for the Gate E OOBI slice: controller,
  witness, mailbox, and agent role-path OOBIs plus `/introduce`-seeded
  continuation now flow through the same durable `oobis.` / `woobi.` ->
  `coobi.` / `eoobi.` / `roobi.` runtime path. Remaining breadth is now
  data/TEL/credential OOBIs and richer auth semantics, not bootstrap honesty.
- Chunk 10 is materially complete: the user-facing CLI surfaces are on the
  shared runtime, and `tufa init` / `tufa incept` no longer stop at DB preload.
  The remaining `tufa agent` concern is packaged tarball/runtime confidence,
  not host ownership design.

## Active Continuation Slice Beyond Gate E

- Planning verdict: do not reopen Chunks 4 through 10 as if bootstrap-critical
  reply/query/receipt behavior were still missing. That slice is landed.
- The active continuation is now:
  - Gate F/G continuation on top of the now-landed first exchange slice:
    direct and mailbox-authorized controller delivery, `Exchanger`, and
    challenge CLI are real, but fuller forwarding/mailbox polling semantics and
    KERIpy interop evidence are still open
  - the broader stale/timeout continuation tail and richer cleanup policy
  - packaged npm/tarball smoke confidence for `tufa agent`
- `/ksn` is not just another generic reply route. In KERIpy it is KEL-owned
  reply handling and depends on accepted key state plus query-not-found escrow.
- `/introduce` is not generic endpoint reply routing either. It belongs with
  `Oobiery`, and accepted introduction replies must enqueue normal `oobis.` work
  instead of bypassing the resolver.
- `Revery` should stay the generic reply verification, BADA, and reply-escrow
  engine. Route semantics belong to the subsystem that owns the meaning.
- "Full escrow handling" for this continuation means more than reply escrow: it
  includes the unverified receipt-family escrows and the query/continuation
  paths that a transferable OOBI-resolved identifier can trigger.
- Incomplete `query` cues are not near-wire messages. They are runtime requests
  for a higher-level correspondent to choose a local habitat, resolve an honest
  attester, and emit a follow-on query only when that correspondence can be
  justified.
- `tufa init` now mirrors KERIpy's bootstrap intent closely enough to be
  honest: when queued `oobis.` or `woobi.` work exists, it hosts the
  command-local runtime, waits for bounded convergence, and fails if bootstrap
  OOBIs end in `eoobi.`.
- `tufa incept` now does the same bounded pre-inception convergence before
  creating local state. It is no longer "runtime blind". The remaining explicit
  rejections such as `--endpoint` and `--proxy` reflect true missing higher-
  level orchestration, not missing shared runtime plumbing.

## Interface and Runtime State

- `Deck<T>` now exists as the KERIpy-shaped queue primitive used across runtime
  interfaces instead of ad hoc arrays or callback chains.
- Typed cue unions now exist for the active runtime families:
  `receipt`, `notice`, `witness`, `query`, `replay`, `reply`, `stream`,
  `keyStateSaved`, `psUnescrow`, and OOBI queue/result cues.
- `createAgentRuntime(hby, options)` and `runAgentRuntime(runtime)` are landed:
  - `AgentRuntime` remains a small composition root with shared `hby`, host
    `mode`, and the shared `cues` deck
  - topic-local state lives behind `Reactor`, `Oobiery`, `MailboxDirector`, and
    `QueryCoordinator`
  - the long-lived doers now mirror the KERIpy mental model: `msgDo`,
    `escrowDo`, `oobiDo`, `queryDo`, plus cue draining
- Role constants covering `controller`, `agent`, `mailbox`, and `witness`
  exist through the runtime/app role surface.
- The KERI dispatch envelope after CESR parsing is landed:
  - it is the typed `keri-ts` analogue to KERIpy parser `exts`
  - it carries the KERIpy family names needed by current runtime work,
    including `sigers`, `wigers`, `cigars`, `trqs`, `tsgs`, `ssgs`, `frcs`,
    `sscs`, `ssts`, `tdcs`, `ptds`, `essrs`, `bsqs`, `bsss`, `tmqs`, and
    `local`
  - it uses named dispatch records or CESR structing records instead of opaque
    anonymous objects
- `Habery` / `Hab` helpers needed by cue-driven endpoint logic are landed:
  `fetchUrls`, `endsFor`, `loadEndRole`, `loadLocScheme`, `replyEndRole`,
  `replyLocScheme`, `replyToOobi`, and `processCuesIter`
- `tufa agent` listeners remain protocol-only:
  - indirect-mode HTTP serving exists for OOBI/resource/mailbox flows in Gate E
  - direct-mode hosting belongs to the same abstraction but still closes in
    Gate F
  - there is still no localhost admin/control surface

## Cue Matrix

Maintainer note:

- the fuller cue-runtime taxonomy, KERIpy producer/consumer trace, and `keri-ts`
  host-sink rationale now live in `docs/adr/adr-0004-cue-runtime-portability.md`
- this matrix remains the Gate E work-planning summary view

| Producer       | `kin`           | Payload Shape                                                                | Consumer                                         | Expected Side Effect                                                           |
| -------------- | --------------- | ---------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------ |
| `Kevery`       | `receipt`       | `serder`                                                                     | `Hab.processCuesIter`                            | emits receipt message bytes                                                    |
| `Kevery`       | `notice`        | `serder`                                                                     | `Hab.processCuesIter`                            | controller-local notice/log side effects                                       |
| `Kevery`       | `witness`       | `serder`                                                                     | `Hab.processCuesIter`                            | emits witness receipt request bytes                                            |
| `Kevery`       | `query`         | `pre`, optional `src`, optional `route`, optional `q/query`, optional `wits` | `QueryCoordinator -> Hab.processCuesIter`        | complete cues emit query bytes; incomplete cues drive correspondent resolution |
| `Kevery`       | `replay`        | `msgs`                                                                       | `Hab.processCuesIter`                            | emits replay stream bytes                                                      |
| `Revery`       | `reply`         | `route`, `data`                                                              | `Hab.processCuesIter`                            | emits reply message bytes                                                      |
| `Kevery`       | `stream`        | `serder`, `pre`, `src`, `topics`                                             | `Hab.processCuesIter`                            | mailbox/witness stream follow-up                                               |
| `Kevery`       | `keyStateSaved` | `ksn`                                                                        | `QueryCoordinator` / runtime completion watchers | state convergence and follow-on log queries                                    |
| `Kevery`       | `psUnescrow`    | `serder`, optional context                                                   | runtime completion watchers                      | partial-signature unescrow signal                                              |
| `OobiResolver` | `oobiQueued`    | `url`, optional alias                                                        | CLI waiters / runtime logs                       | resolve accepted into runtime queue                                            |
| `OobiResolver` | `oobiResolved`  | `url`, `cid`, optional `role`, optional `eid`                                | CLI waiters / runtime logs                       | OOBI moved to `roobi`                                                          |
| `OobiResolver` | `oobiFailed`    | `url`, `reason`                                                              | CLI waiters / runtime logs                       | OOBI moved to retry/failure state                                              |

## Chunks

### Chunk 0: Write the Gate E plan artifact first

- Status reconciliation (2026-04-05):
  - complete
  - this plan exists, the init/incept reconciliation plan points at it, and the
    cue matrix plus chunk history now serve as the execution-tracking view
  - the durable maintainer architecture references have since split out into
    ADRs and design docs; this file should stay current as a status map, not
    become the only source of truth again

### Chunk 1: Build the cue-driven `AgentRuntime` foundation

- Status reconciliation (2026-04-05):
  - materially complete
  - `AgentRuntime` is now the small shared composition root for `hby`, host
    mode, and the shared cue deck
  - `Reactor`, `Oobiery`, `MailboxDirector`, and `QueryCoordinator` own their
    topic-local state and long-running flows
  - command-local hosting and long-lived `tufa agent` hosting now use the same
    runtime bundle
  - continuous `msgDo`, cue draining, `escrowDo`, `oobiDo`, and `queryDo` loops
    exist and yield every runtime turn

### Chunk 2: Port config preload and bootstrap queues

- Status reconciliation (2026-04-05):
  - complete for the Gate E bootstrap slice
  - config ingestion now seeds `oobis.` and `woobi.` during habery creation/open
  - the shared runtime consumes those durable queues instead of bespoke
    one-off bootstrap logic
  - `tufa init` and `tufa incept` now host the command-local runtime long
    enough to drive queued bootstrap work to bounded success/failure state

### Chunk 3: Add parser normalization and dispatch

- Status reconciliation (2026-04-05):
  - materially complete for active KERI runtime work
  - the existing CESR parser now feeds a typed KERI dispatch envelope with the
    KERIpy family names the runtime needs
  - current `ilk` dispatch covers KEL events, receipts, replies, and queries
    well enough to support bootstrap/runtime/query/receipt closure
  - EXN / TEL breadth remains later work, but parser normalization is no longer
    blocking honest progress

### Chunk 4: Broaden reply routing and BADA-RUN beyond the landed bootstrap slice

- Status reconciliation (2026-04-05):
  - materially complete for the real Gate E reply surface
  - landed routes now include `/end/role/add`, `/end/role/cut`,
    `/loc/scheme`, `/ksn/{aid}`, `/watcher/{aid}/{action}`, and `/introduce`
  - route ownership is now explicit and honest:
    - `Revery` verifies, applies BADA, persists reply artifacts, and owns reply
      escrow/replay
    - `Kevery` owns KEL-derived reply families such as `/ksn` and watcher
      replies
    - `Oobiery` owns OOBI-introduction reply families such as `/introduce`
  - reply success and follow-on actions now surface through cues and runtime
    continuation rather than hidden helper calls
  - remaining reply breadth belongs to later communication/exchange work, not
    the bootstrap slice

### Chunk 5: Complete cue processing and endpoint/location/OOBI state projection

- Status reconciliation (2026-04-05):
  - materially complete for the active Gate E runtime slice
  - `fetchUrls`, `endsFor`, `loadEndRole`, `loadLocScheme`, `replyToOobi`, and
    `Hab.processCuesIter()` are all landed
  - cue-driven materialization is now real for `receipt`, `witness`, complete
    `query`, `reply`, `replay`, and `stream`
  - `/ksn` follow-on work, query recovery, and introduction-driven continuation
    now move through cues and runtime coordination instead of hidden side
    effects
  - the remaining cue gap is broader transport/exchange breadth, not the core
    cue-to-wire contract

### Chunk 6: Complete indirect-mode protocol serving and reply-based OOBI bootstrap

- Status reconciliation (2026-04-05):
  - materially complete for the indirect bootstrap/resource host slice
  - the server now accepts CESR `POST` / `PUT`, serves OOBI/resource responses
    from local reply/auth material, serves mailbox SSE for `mbx`, and exposes a
    local `/health` route for host readiness checks
  - role-based dissemination for `controller`, `mailbox`, `witness`, and
    `agent` OOBIs is now real where local state permits
  - introduction-driven continuation stays on the same parser -> routing ->
    escrow -> finalization path
  - remaining host work is broader direct/forwarding/exchange transport breadth,
    not protocol-only bootstrap serving

### Chunk 7: Implement `Kevery` core event processing, first-seen logic, seals, and delegated-event handling

- Status reconciliation (2026-04-05):
  - materially complete for the active Gate E slice
  - remote event acceptance, durable log/current-state updates, first-seen
    persistence, and follow-on cue emission are all real
  - landed evidence includes `/watcher/{aid}/{action}` reply routing, stricter
    non-lax `/ksn` source acceptance, runtime `QueryCoordinator` handling for
    incomplete `query` cues, and continuation tracking through runtime
    pending-state convergence
  - remaining work has moved to stale/timeout continuation parity and broader
    transport/exchange/direct communications closure, not more core event/cue
    side effects

### Chunk 8: Implement continuous KEL escrow processing needed for transferable/bootstrap acceptance

- Status reconciliation (2026-04-05):
  - materially complete for the real Gate E receipt/query escrow slice
  - KEL escrows now run every runtime turn with no timer-based polling gap
  - the planned runtime passes are landed:
    - `processEscrowOutOfOrders`
    - `processEscrowUnverWitness`
    - `processEscrowUnverNonTrans`
    - `processEscrowUnverTrans`
    - `processEscrowPartialDels`
    - `processEscrowPartialWigs`
    - `processEscrowPartialSigs`
    - `processEscrowDuplicitous`
    - `processEscrowDelegables`
    - `processEscrowMisfits`
    - `processQueryNotFound`
  - attached replay receipt handling for cloned KEL events is also landed via
    `processAttachedReceiptCouples(...)`,
    `processAttachedReceiptQuadruples(...)`, and `escrowTRQuadruple(...)`
  - the remaining escrow work is the broader stale/timeout policy tail and
    non-bootstrap families, not these core passes

### Chunk 9: Complete the OOBI resolver beyond simple role-path fetches

- Status reconciliation (2026-04-05):
  - materially complete for the honest Gate E OOBI slice
  - witness, controller, mailbox, and agent role-path OOBIs now route through
    the durable `Oobiery` queue state and shared cue deck
  - CESR-stream fetch -> parse -> route -> persist flow is real and preserves
    alias hints plus deterministic `coobi.` / `eoobi.` / `roobi.` transitions
  - `/introduce`-seeded OOBIs stay on the same normal parser/routing/escrow
    path instead of using resolver shortcuts
  - `woobi.` continuation/auth convergence is now carried far enough for honest
    `init` / open bootstrap behavior
  - remaining breadth is now data/TEL/credential OOBIs and richer follow-on
    authentication semantics, not the bootstrap resolver core

### Chunk 10: Add the Gate E CLI surfaces on top of the shared runtime

- Status reconciliation (2026-04-05):
  - materially complete
  - `tufa loc add` and `tufa ends add` now create signed replies, feed them
    through the local runtime, and confirm state through `loadLocScheme()` /
    `loadEndRole()`
  - `tufa oobi generate` supports the active Gate E role set, including `agent`
    generation when local endpoint state exists
  - `tufa oobi resolve` hosts the runtime in-process, enqueues the OOBI job,
    and waits for durable completion
  - `tufa agent` hosts the same shared runtime long-lived and still exposes
    only protocol routes
  - `tufa init` and `tufa incept` now belong in the same runtime-backed CLI
    story: both host bounded command-local convergence when queued bootstrap
    work exists
  - no command depends on a localhost admin endpoint

## Init/Incept Readiness Criteria

- Status reconciliation (2026-04-05):
  - `tufa init` now does more than create stores when config preload exists:
    after habery open it hosts a command-local runtime, waits for queued
    bootstrap OOBIs to settle within a bounded turn budget, and fails if
    bootstrap work ends in `eoobi.`
  - `tufa incept` now remains local-creation first without being runtime-blind:
    it performs the same bounded bootstrap convergence before creating the local
    identifier
  - explicit `tufa incept` rejections now more honestly mean "missing higher-
    level orchestration we have not implemented yet", such as endpoint
    receipting or delegation proxy flow, not "the runtime cannot consume remote
    state"

### Chunk 11: Extend the same runtime after Gate E

- Status reconciliation (2026-04-05):
  - deferred beyond Gate E and still active for later work
  - the next honest runtime expansion remains direct-mode hosting plus the
    broader forwarding/exchange transport surface in Gate F
  - `Exchanger`, `Tevery`, broker txn-state escrows, and registrar escrows
    should stay on the same Deck/cue/continuous-loop model when they land

## Test Plan

- Unit tests for `Deck<T>` must prove KERIpy-like FIFO and requeue behavior
- Unit tests must prove cue processing is cue-by-cue and order-stable
- Unit tests must prove the continuous escrow worker runs every scheduler turn
  without timer-based polling
- Unit tests must cover bootstrap-scope BADA-RUN acceptance, rejection,
  idempotence, and reply escrow/unescrow
- Unit tests must cover `Hab.processCuesIter`-style behavior and cue-to-message
  generation
- Unit tests must cover first-seen persistence, delegation/seal escrows, and
  successful recovery
- Unit tests must cover generic OOBI URL parsing and role handling for
  `witness`, `controller`, `mailbox`, and `agent`
- Integration tests must prove command-local runtime hosting and long-lived
  `tufa agent` hosting use the same runtime and produce the same results
- Integration tests must prove config preload can bootstrap endpoint knowledge
  through both `oobis.` and `woobi.`
- Integration tests must prove `tufa init` hosts the runtime long enough to
  converge config-seeded `oobis.` / `woobi.` state instead of merely preloading
  rows
- Integration tests must prove `loc add` and `ends add --role mailbox` update
  local state through the runtime, not via direct DB mutation
- Integration tests must prove mailbox OOBI generation and mailbox OOBI
  resolution work end-to-end against KERIpy
- Integration tests must prove controller, witness, and agent OOBI flows work
  end-to-end in the shared runtime
- Integration tests must prove introduction-driven and `/ksn`-dependent
  transferable bootstrap flows work without parser/routing shortcuts
- Integration tests must prove out-of-order and delegated remote events fetched
  from OOBIs escrow and later finalize within the bootstrap acceptance slice
- Integration tests must verify that `tufa agent` exposes only protocol surfaces
  and no local admin API
- Release-facing smoke must also exercise the packed npm artifact
  (`init -> incept -> agent -> /health`) because Deno-source runtime evidence is
  no longer sufficient for `tufa agent` confidence
- Documentation verification must include the new Gate E plan file and its cue
  matrix so the architecture is recoverable in future sessions

## Assumptions and Defaults

- KERIpy's flow-based programming model is a hard constraint for Gate E
- `Deck` + cues are mandatory, not optional
- Deviating from cue-driven design requires an explicit, documented exception
  and should be treated as a last resort
- Local CLI commands remain the only local administrative interface for
  DB/keystore mutation
- `tufa agent` is a host for the shared runtime, not a separate control plane
- Indirect-mode HTTP serving is required in Gate E because remote peers must
  resolve generated OOBIs
- Direct-mode TCP hosting belongs to the same abstraction but closes in Gate F
- Mailbox OOBI generation is part of Gate E minimum evidence
- Agent OOBI resolution is part of Gate E minimum evidence
- Gate E completion means honest bootstrap closure, not full receipt/reply
  parity across every later runtime family
- Config-seeded witness bootstrap through `woobi.` is part of Gate E; broader
  `woobi.` continuation semantics are not
- Packed npm/tarball smoke is a release gate for `tufa agent`, not an optional
  nice-to-have, because source and packaged runtime behavior can drift
- Data OOBIs and TEL/credential txn-state escrows remain the next major chunk
  after Gate E
