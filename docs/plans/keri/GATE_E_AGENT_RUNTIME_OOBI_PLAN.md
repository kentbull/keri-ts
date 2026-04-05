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

## Status Reconciliation (2026-04-03)

- Verdict: Gate E is complete only as a bootstrap/runtime slice. It was not
  honestly complete against the earlier wording that implied full reply,
  receipt, and escrow breadth.
- Closed evidence in the repo now includes:
  - shared `AgentRuntime` hosting through both local commands and `tufa agent`
  - runtime-backed `tufa loc add` and `tufa ends add`
  - runtime-backed `tufa oobi generate` / `tufa oobi resolve`
  - config preload feeding bootstrap URLs into `oobis.` and `woobi.` with the
    shared runtime consuming both queues
  - local end-to-end coverage for controller, witness, mailbox, and agent OOBI
    flows
  - live KERIpy parity evidence for `loc add`, `ends add`, mailbox OOBI
    generate, and mailbox OOBI resolve
  - protocol-only host coverage for `tufa agent`
- Deferred beyond Gate E:
  - broader direct/mailbox/forwarding/exchange transport breadth
  - stricter stale/timeout continuation, MFA, and retry-convergence semantics
  - wider reply/query correspondence beyond the current bootstrap-critical
    KERIpy slice
- Planning rule: those deferred items still matter, but they are no longer Gate
  E exit criteria. They belong to later runtime/comms/escrow closure work.

## Current Implementation Reality (2026-04-03)

Maintainer note:

- the durable maintainer docs for the Chunk 7 query/watcher slice now live in
  `docs/design-docs/keri/QUERY_REPLY_CORRESPONDENCE_AND_WATCHER_SUPPORT.md` and
  `docs/adr/adr-0008-escrow-decision-architecture.md`
- this plan remains the execution history and work-tracking view, not the
  primary long-term architecture reference

- Chunk 1 is materially complete: the shared `AgentRuntime` composition root,
  `Reactor`, `Oobiery`, and the long-lived/local host split all exist.
- Chunk 2 is materially complete: config preload seeds `oobis.` / `woobi.` and
  the shared runtime consumes both queues.
- Chunk 3 is not exhaustive, but it is complete enough as the parser-to-runtime
  seam to stop blocking on it. The envelope exists, normalized attachment
  families exist, and current `ilk` dispatch is sufficient to move active work
  forward.
- Chunk 4 is materially complete for the init/incept-critical reply families:
  `/end/role/*`, `/loc/scheme`, `/ksn/{aid}`, and `/introduce` are now routed
  through their intended owners, but broader reply families still remain.
- Chunk 5 is materially complete for the receipt/query runtime core: `Hab`-owned
  cue semantics, mailbox `stream` capture, `logs` / `ksn` / `mbx` query routing,
  and `receipt` / `witness` wire materialization are landed. The remaining cue
  gap is now broader follow-on transport/exchange breadth, not the core
  receipt/query families themselves.
- Chunk 6 is materially complete for the first indirect-host slice: the server
  now accepts CESR `POST` / `PUT`, serves mailbox SSE for `mbx`, and continues
  OOBI discovery through `/introduce`, but fuller forwarding / exchange breadth
  is still later work.
- Chunk 7 is now materially complete for the broader query/reply correspondence
  slice: incomplete `query` cues flow through a runtime `QueryCoordinator`,
  `/watcher/{aid}/{action}` is KEL-owned, `/ksn` trust-source parity is tighter,
  and runtime pending-state convergence includes active query continuations.
- Chunk 8 is now materially complete for the KERIpy receipt/query parity slice:
  the unverified witness / non-transferable / transferable receipt escrows,
  KERIpy-aligned 300-second `query-not-found` retry policy, replay-attached
  receipt handling for cloned KEL events (`processAttachedReceiptCouples`,
  `processAttachedReceiptQuadruples`, `escrowTRQuadruple`), and transferable
  query ingress via `ssgs` are all landed. The remaining escrow work is now the
  broader stale-policy and non-receipt tail, not the core receipt/query
  correspondence path.
- Chunk 9 works for direct role-path bootstrap OOBIs, but not for the wider
  reply-driven introduction/bootstrap behavior KERIpy uses.
- Chunk 10 no longer stops at bootstrap-only behavior: `tufa init`,
  `tufa incept`, and `tufa oobi resolve` now drive bounded runtime convergence,
  though they still depend on later forwarding / transport breadth for complete
  communications closure.

## Active Continuation Slice For Reasonably Done `init` / `incept`

- Planning verdict: treat Chunks 1 through 8 as materially complete for the
  honest bootstrap/runtime/query-and-receipt-correspondence slice. The active
  work is now the remaining escrow-policy tail in Chunk 9 and the Gate F comms
  bridge around direct/mailbox/forwarding/exchange breadth.
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
- `tufa init` should mirror KERIpy init when config preload exists: host the
  command-local runtime, wait for `roobi.` outcomes, and authenticate the
  `woobi.` path instead of just preloading DB rows.
- `tufa incept` should remain local-creation first, but it should stop assuming
  that "local" means "runtime-blind". It must be able to consume accepted peer
  state produced by prior or inline OOBI resolution when that state is part of
  the honest prerequisite surface.

## Interface and Runtime Changes

- Add an internal `Deck<T>` abstraction in `keri-ts` with KERIpy-shaped
  semantics and naming:
  - `push`, `pull`, `append`, `clear`, iteration, length
  - use it in runtime interfaces instead of arrays, event emitters, or ad hoc
    queues
- Add typed cue unions for the Gate E runtime:
  - start with the KERI families needed now: `receipt`, `notice`, `witness`,
    `query`, `replay`, `reply`, `stream`, `keyStateSaved`, `psUnescrow`, OOBI
    resolution/result cues
  - preserve `kin`-first cue shape so KERIpy cue producers/consumers can be
    ported cue-by-cue
- Add `createAgentRuntime(hby, options)` and `runAgentRuntime(runtime)`:
  - `AgentRuntime` is a composition root with only truly shared state: `hby`,
    `mode`, and the shared `cues` deck
  - topic-local state and long-running flows live behind component-owned classes
    such as `Reactor`, `Oobiery`, and `QueryCoordinator`
  - runtime children should mirror KERIpy mental model: `msgDo`, `escrowDo`,
    `oobiDo`, and `queryDo`
- Add `EndpointRole` constants covering at least `controller`, `agent`,
  `mailbox`, and `witness`
- Add a KERI dispatch envelope after CESR parsing:
  - make it the typed `keri-ts` equivalent of KERIpy parser `exts`, not just a
    bootstrap subset
  - carry the full parser-state accumulation families needed for later dispatch:
    `sigers`, `wigers`, `cigars`, `trqs`, `tsgs`, `ssgs`, `frcs`, `sscs`,
    `ssts`, `tdcs`, `ptds`, `essrs`, `bsqs`, `bsss`, `tmqs`, and `local`
  - keep the KERIpy family names on the envelope, but represent each family
    element as a named dispatch value object rather than an anonymous object
    literal
  - keep any TS-friendly convenience on the envelope as derived getters, not as
    parallel raw-object aliases that compete with the primary contract
- Add `Habery` / `Hab` helpers needed by cue-driven endpoint logic:
  - `fetchUrls`
  - `endsFor`
  - `loadEndRole`
  - `loadLocScheme`
  - `replyEndRole`
  - `replyLocScheme`
  - `replyToOobi`
  - `processCuesIter`
- Keep `tufa agent` network listeners protocol-only:
  - indirect-mode HTTP serving for OOBI/resource flows in Gate E
  - direct-mode TCP host adapter defined under the same abstraction, but
    correctness closure belongs to Gate F
  - no localhost admin/control surface

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

- Create this dedicated Gate E subplan at
  `docs/plans/keri/GATE_E_AGENT_RUNTIME_OOBI_PLAN.md`
- Write the full architecture, chunk order, acceptance criteria, and KERIpy
  correspondence into that file before implementation starts
- Include a cue matrix section in that plan:
  - producer
  - `kin`
  - payload shape
  - consumer
  - expected side effect
- Add a pointer from `INIT_INCEPT_RECONCILIATION_PLAN.md` to the new Gate E
  subplan so future sessions can rehydrate quickly without relying on thread
  context

### Chunk 1: Build the cue-driven `AgentRuntime` foundation

- Implement the shared runtime and host adapters for:
  - command-local CLI hosting
  - long-lived `tufa agent` hosting
- Shrink `AgentRuntime` into a composition root and move topic-local state
  behind component-owned classes
- Introduce `Reactor` to own:
  - parse/message worker
  - reply routing and `Revery`
  - `Kevery`
  - escrow worker
- Introduce `Oobiery` to own:
  - durable OOBI queue state and processing
  - OOBI worker
- Make every major subsystem communicate through `Deck`s and cues or through
  KERIpy-style durable DB queues, not direct callback chains
- Make the escrow and cue workers continuous:
  - drain what is available
  - yield
  - repeat every turn

### Chunk 2: Port config preload and bootstrap queues

- Add `Habery.reconfigure()`-style config ingestion for `iurls`, `durls`, and
  `wurls`
- Seed `oobis` and `woobi` from config during init/open
- Feed those bootstrap URLs into runtime decks instead of bespoke one-off init
  logic
- Allow command-local runtime hosting to resolve bootstrap OOBIs during
  init/open when needed for endpoint readiness

### Chunk 3: Add parser normalization and dispatch

- Reuse the existing CESR parser
- Add the KERI app-layer normalization step that converts parsed attachment
  groups into the full typed KERIpy-style parser accumulation envelope expected
  by runtime code
- Dispatch by `ilk` into KEL events, receipts, replies, queries, and later
  EXN/TEL
- Push follow-on work into runtime cues instead of embedding side effects inside
  the parser loop

### Chunk 4: Broaden reply routing and BADA-RUN beyond the landed bootstrap slice

- Keep `/end/role/add`, `/end/role/cut`, and `/loc/scheme` as the landed
  baseline.
- Add `/ksn/{aid}` through a KEL-owned handler that persists `kdts.` / `ksns.` /
  `knas.` and emits `keyStateSaved` from the normal runtime path.
- Add `/introduce` through `Oobiery` route registration so accepted reply data
  feeds new `oobis.` work back into the ordinary resolver pipeline.
- Keep route ownership honest:
  - `Revery` verifies, applies BADA rules, persists reply artifacts, and owns
    reply escrow.
  - `Kevery` owns KEL-derived reply families such as `/ksn`.
  - `Oobiery` owns OOBI-introduction reply families such as `/introduce`.
- Expand BADA-RUN from the bootstrap subset to the reply families needed for
  init/open/incept continuation:
  - route-base normalization
  - old-said lookup
  - dater ordering
  - idempotence
  - endorsement verification
  - escrow when prior dependencies are missing
- Persist reply artifacts through the KERI reply stores
- Make reply success and follow-on actions visible through cues, not hidden
  direct calls

### Chunk 5: Complete cue processing and endpoint/location/OOBI state projection

- Land `fetchUrls`, `endsFor`, `loadEndRole`, `loadLocScheme`, and `replyToOobi`
- Port `Hab.processCuesIter` semantics so cue-to-message behavior remains
  recognizable to KERIpy maintainers
- Materialize the cue families that now still degrade to notify-only or partial
  behavior when they are part of the real runtime path:
  - `receipt`
  - `witness`
  - complete `query`
  - `reply`
  - `replay`
  - `stream`
- Process reply-derived endpoint/location updates through cue-driven flows
  wherever KERIpy does
- Make `/ksn` follow-on work, query recovery, and introduction-driven
  continuation visible through cues instead of hidden helper calls
- Treat cue portability as a first-class design goal, not an implementation
  detail

### Chunk 6: Complete indirect-mode protocol serving and reply-based OOBI bootstrap

- Keep the landed KERIpy-like OOBI/resource HTTP routes used by remote peers
- Back those routes with `replyToOobi()` and stored reply/auth material
- Add the reply-based bootstrap/resource variants needed for transferable
  identifier discovery and introduction-driven OOBI continuation
- Support role-based dissemination needed for `witness`, `controller`,
  `mailbox`, and `agent` OOBI discovery where local state permits
- Ensure served payloads include the cloned KEL and reply-auth material remote
  peers need to verify returned `/loc/scheme`, `/end/role/*`, `/ksn`, and
  introduction-driven continuation data
- Keep this listener protocol-only and avoid any local administrative RPC

### Chunk 7: Implement `Kevery` core event processing, first-seen logic, seals, and delegated-event handling

- Build remote event acceptance, durable log updates, current-state updates, and
  first-seen persistence
- Populate first-seen and seal/source stores required by replay and delegation
  semantics
- Treat missing delegator anchors and related dependencies as escrow cases
- Push follow-on work such as receipts, notices, witness actions, queries, and
  replies into `Kevery.cues`
- Status reconciliation (2026-04-05):
  - materially complete for the broader query/reply correspondence slice
  - landed evidence includes `/watcher/{aid}/{action}` reply routing, stricter
    non-lax `/ksn` source acceptance (self, KSN backer, or configured watcher),
    runtime `QueryCoordinator` handling for incomplete `query` cues, and
    continuation tracking through runtime pending-state convergence
  - remaining work has moved to stale/timeout continuation parity and broader
    transport/exchange/direct communications closure, not more Chunk 7 side
    effects

### Chunk 8: Implement continuous KEL escrow processing needed for transferable/bootstrap acceptance

- Run KEL escrows every runtime turn with no timer-based polling gap
- Implement the escrow passes required by honest bootstrap continuation:
  - `processEscrowOutOfOrders`
  - `processEscrowUnverWitness`
  - `processEscrowUnverNonTrans`
  - `processEscrowUnverTrans`
  - `processEscrowPartialDels`
  - `processEscrowPartialWigs`
  - `processEscrowPartialSigs`
  - `processEscrowDuplicitous`
  - `processEscrowMisfits`
  - `processQueryNotFound`
- Implement `processEscrowDelegables` as an explicit adjacent pass
- Emit cues where KERIpy emits cues during successful unescrow/finalization
  paths

### Chunk 9: Complete the OOBI resolver beyond simple role-path fetches

- Support witness, controller, mailbox, and agent role-path OOBIs generically
- Support CESR-stream responses first and the reply-based variants needed for
  ecosystem interop
- Drive `oobis.` / `woobi.` -> `coobi.` / `eoobi.` -> `roobi.` through `Oobiery`
  durable queue state and the shared cue deck
- Support `/introduce`-seeded OOBIs and keep those follow-on discoveries on the
  same parser -> routing -> escrow -> finalization path
- Preserve alias hints and deterministic failure states
- Do not allow resolver shortcuts that bypass parser, routing, or escrow logic
- Carry `woobi.` continuation and MFA/auth convergence far enough for command
  parity on `init` / open paths

### Chunk 10: Add the Gate E CLI surfaces on top of the shared runtime

- `tufa loc add`
  - create the signed reply
  - feed it through the local runtime
  - wait on runtime-visible completion/cue conditions
  - confirm `loadLocScheme()`
- `tufa ends add`
  - create the signed reply
  - feed it through the local runtime
  - wait on runtime-visible completion/cue conditions
  - confirm `loadEndRole()`
- `tufa oobi generate`
  - support at least `witness`, `controller`, and `mailbox`
  - support `agent` generation when local endpoint state exists
- `tufa oobi resolve`
  - host the runtime in-process
  - enqueue the OOBI job
  - wait for `roobi` / completion cues
  - exit cleanly
- `tufa agent`
  - host the same shared runtime long-lived
  - expose only protocol routes needed for OOBI/resource serving
- None of these commands may depend on a localhost admin endpoint

## Init/Incept Readiness Criteria

- `tufa init` should do more than create stores when config preload exists:
  after habery open it should host a command-local runtime, wait for queued
  bootstrap OOBIs to settle into success/failure state, and run the well-known
  authentication path that KERIpy init already performs.
- `tufa incept` should remain single-sig/local-creation first, but it should be
  allowed to rely on accepted remote controller/delegator/witness state that was
  produced by the shared runtime rather than pretending all prerequisites are
  local-only.
- Explicit `tufa incept` rejections should now mean "missing orchestration we
  have not implemented yet", not "the runtime cannot consume the remote state we
  already resolved elsewhere".

### Chunk 11: Extend the same runtime after Gate E

- Add direct-mode TCP hosting under the same runtime abstraction and close its
  correctness in Gate F
- Add `Exchanger` with `processEscrowPartialSigned`
- Add `Tevery` and broker txn-state escrows
- Add registrar escrows
- Keep all of them on the same Deck/cue/continuous-loop model

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
- Data OOBIs and TEL/credential txn-state escrows remain the next major chunk
  after Gate E
