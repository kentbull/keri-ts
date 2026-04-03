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
  - `/ksn`, `/introduce`, and broader reply-routing families
  - receipt/witness wire materialization from cues
  - `processEscrowUnverWitness`, `processEscrowUnverNonTrans`, and
    `processEscrowUnverTrans`
  - broader `woobi.` continuation, MFA, and retry-convergence semantics
- Planning rule: those deferred items still matter, but they are no longer Gate
  E exit criteria. They belong to later runtime/comms/escrow closure work.

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
    such as `Reactor` and `Oobiery`
  - runtime children should mirror KERIpy mental model: `msgDo`, `escrowDo`, and
    `oobiDo`
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

- the fuller cue-runtime taxonomy, KERIpy producer/consumer trace, and
  `keri-ts` host-sink rationale now live in
  `docs/adr/adr-0004-cue-runtime-portability.md`
- this matrix remains the Gate E work-planning summary view

| Producer       | `kin`           | Payload Shape                                 | Consumer                    | Expected Side Effect                     |
| -------------- | --------------- | --------------------------------------------- | --------------------------- | ---------------------------------------- |
| `Kevery`       | `receipt`       | `serder`                                      | `Hab.processCuesIter`       | emits receipt message bytes              |
| `Kevery`       | `notice`        | `serder`                                      | `Hab.processCuesIter`       | controller-local notice/log side effects |
| `Kevery`       | `witness`       | `serder`                                      | `Hab.processCuesIter`       | emits witness receipt request bytes      |
| `Kevery`       | `query`         | `pre`, `src`, optional `route`, optional `q`  | `Hab.processCuesIter`       | emits query message bytes                |
| `Kevery`       | `replay`        | `msgs`                                        | `Hab.processCuesIter`       | emits replay stream bytes                |
| `Revery`       | `reply`         | `route`, `data`                               | `Hab.processCuesIter`       | emits reply message bytes                |
| `Kevery`       | `stream`        | `serder`, `pre`, `src`, `topics`              | `Hab.processCuesIter`       | mailbox/witness stream follow-up         |
| `Kevery`       | `keyStateSaved` | `ksn`                                         | runtime completion watchers | state convergence signal                 |
| `Kevery`       | `psUnescrow`    | `serder`, optional context                    | runtime completion watchers | partial-signature unescrow signal        |
| `OobiResolver` | `oobiQueued`    | `url`, optional alias                         | CLI waiters / runtime logs  | resolve accepted into runtime queue      |
| `OobiResolver` | `oobiResolved`  | `url`, `cid`, optional `role`, optional `eid` | CLI waiters / runtime logs  | OOBI moved to `roobi`                    |
| `OobiResolver` | `oobiFailed`    | `url`, `reason`                               | CLI waiters / runtime logs  | OOBI moved to retry/failure state        |

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

### Chunk 4: Implement bootstrap-scope `Revery`, reply routing, and enough BADA-RUN for endpoint/location/OOBI bootstrap

- Register and handle `/end/role/add`, `/end/role/cut`, and `/loc/scheme`
- Implement the BADA-RUN subset needed for endpoint/location/OOBI bootstrap:
  - route-base normalization
  - old-said lookup
  - dater ordering
  - idempotence
  - endorsement verification
  - escrow when prior dependencies are missing
- Persist reply artifacts through the KERI reply stores
- Make reply success and follow-on actions visible through cues, not hidden
  direct calls
- Defer `/ksn`, `/introduce`, and broader reply families to post-Gate-E runtime
  breadth

### Chunk 5: Implement endpoint and location state plus cue processing

- Land `fetchUrls`, `endsFor`, `loadEndRole`, `loadLocScheme`, and `replyToOobi`
- Port `Hab.processCuesIter` semantics so cue-to-message behavior remains
  recognizable to KERIpy maintainers
- Process reply-derived endpoint/location updates through cue-driven flows
  wherever KERIpy does
- Treat cue portability as a first-class design goal, not an implementation
  detail

### Chunk 6: Implement indirect-mode protocol serving for OOBI flows

- Expose KERIpy-like OOBI/resource HTTP routes used by remote peers
- Back those routes with `replyToOobi()` and stored reply/auth material
- Support role-based dissemination needed for `witness`, `controller`,
  `mailbox`, and `agent` OOBI discovery where local state permits
- Keep this listener protocol-only and avoid any local administrative RPC

### Chunk 7: Implement `Kevery` core event processing, first-seen logic, seals, and delegated-event handling

- Build remote event acceptance, durable log updates, current-state updates, and
  first-seen persistence
- Populate first-seen and seal/source stores required by replay and delegation
  semantics
- Treat missing delegator anchors and related dependencies as escrow cases
- Push follow-on work such as receipts, notices, witness actions, queries, and
  replies into `Kevery.cues`

### Chunk 8: Implement continuous KEL escrow processing needed for bootstrap acceptance

- Run KEL escrows every runtime turn with no timer-based polling gap
- Implement the escrow passes already required by bootstrap event acceptance:
  - `processEscrowOutOfOrders`
  - `processEscrowPartialDels`
  - `processEscrowPartialWigs`
  - `processEscrowPartialSigs`
  - `processEscrowDuplicitous`
  - `processEscrowMisfits`
  - `processQueryNotFound`
- Implement `processEscrowDelegables` as an explicit adjacent pass
- Emit cues where KERIpy emits cues during successful unescrow/finalization
  paths
- Defer receipt-family unverified escrow passes to later communications/receipt
  parity work

### Chunk 9: Implement the bootstrap OOBI resolver

- Support witness, controller, mailbox, and agent role-path OOBIs generically
- Support CESR-stream responses first and the reply-based variants needed for
  ecosystem interop
- Drive `oobis.` / `woobi.` -> `coobi.` / `eoobi.` -> `roobi.` through
  `Oobiery` durable queue state and the shared cue deck
- Preserve alias hints and deterministic failure states
- Do not allow resolver shortcuts that bypass parser, routing, or escrow logic
- Defer broader `woobi.` continuation and MFA-style convergence semantics
  beyond config/bootstrap seeding

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
- Integration tests must prove `loc add` and `ends add --role mailbox` update
  local state through the runtime, not via direct DB mutation
- Integration tests must prove mailbox OOBI generation and mailbox OOBI
  resolution work end-to-end against KERIpy
- Integration tests must prove controller, witness, and agent OOBI flows work
  end-to-end in the shared runtime
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
