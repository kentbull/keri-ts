# Cue delivery refactor

Status: approved plan; implementation and qualification in progress. The starting
revision is `6c8e5971ea8f40ac1ad2de3b26080196235e7651`. This plan does not extend
the published 1.0.0 qualification to subsequent changes. PR #524 was closed
unmerged; its responder extraction is background evidence, not the implementation
base. The first implementation cut contains phase 0 and the ownership-only part
of phase 1. Later phases require their own focused changes and validation.

## Decision and boundaries

Use KERIpy-shaped owners and ordinary queued records. Respondant interprets and
publishes reply work; Poster owns outbound execution. The final design uses one
Poster `evts` queue, ordinary nested iteration, and explicit retained failures.
Remove manual reply traversal and automatic exact-packet retry only in phase 3,
after delivery ownership and callers have moved without changing those policies.

Keep typed `ReplyCue` alternatives, signing rules, source authorization, request
correlation, TSN registry-before-credential order and independent HTTP response
lifetimes. QueryCoordinator remains a separate owner. Do not introduce a generic
executor, scheduler, retry framework, resource protocol, compatibility shim or a
second immediate-send path. The [reliability roadmap](cue-reliability-roadmap.md)
owns deliberately deferred reliability features.

Names in the final design are `Respondant`, `postman`, `evts`, `cues`, `failures`,
`src`, `dest`, `msg` and `msgs`, including `ReplayCue.msgs` and `runtime.postman`.
Each implementation cut updates callers coherently; old names need no shims.

## Reference matrix

These are distinct immutable references. A behavior observed in one must not be
attributed to the other. Neither source inspection nor a declared pin qualifies a
running environment; record imported modules and actual revisions for live tests.

| Concern             | Protocol reference                                                                  | GLEIF operational reference                                     | Planned TypeScript treatment                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Authority           | KERIpy `7143832813cac6a394ab1faf9be83bb3372be87c`                                   | GLEIF v1.2.17 `b8626e1d58770a4a480ea72a01acc5580278a9f2`        | Preserve protocol framing/signing authority; use the GLEIF reference for the scoped delivery lifecycle comparison   |
| Cue interpretation  | `app/habbing.py:BaseHab.processCuesIter` consumes cue dictionaries and yields bytes | Same concrete habitat responsibility                            | Raw cue-to-message construction; no universal wire/notify/transport wrapper                                         |
| Reply publication   | `app/storing.py:Respondant.cueDo` loops replay messages and calls `postman.send`    | `Respondant` also prepares/signs reply work before publication  | Respondant prepares source messages and publishes ordinary Poster records                                           |
| Delivery queue      | `app/forwarding.py:Poster.send` appends to `evts`; `deliverDo` owns delivery        | Same queue/worker boundary                                      | One queue for all Poster execution; ingress and producers publish without draining it                               |
| Completion identity | Poster cues contain destination, topic and SAID                                     | `sent(said)` scans prior cues                                   | Each optional outcome identifies its concrete queued operation; stale SAID success cannot satisfy a later operation |
| Transport lifecycle | Protocol reference is not a remote-acceptance guarantee                             | GLEIF lifecycle paths and their tests are the comparison target | Verify local TCP drain separately from later connection cleanup; HTTP success requires successful body completion   |
| Retry and recovery  | Ordinary queues/generators do not establish durable retry                           | Operational behavior does not imply application acknowledgement | Phase 3 retains a failed whole event for explicit retry/discard; no automatic retry or crash-recovery claim         |

The broader [reference environment inventory](../qualification/REFERENCE_ENVIRONMENTS.md)
retains separate mailbox-fork, frozen-vector and embedded-resolver profiles. This
plan does not replace their pins or grant new interop credit.

## Phase 0: persist scope and establish the baseline

- Save this plan and the reliability roadmap before implementation.
- Start from verified `master` revision `6c8e5971` in the clean dedicated
  `cue-delivery` worktree. Preserve the main checkout's existing formatting edit.
- Read current instructions, source, tests and both declared references. Inventory
  callers and independent behavior assertions before moving responsibilities.
- Keep phases as reviewable sequential cuts. The first cut must not acquire
  phase 2 or phase 3 behavior merely because the affected files are adjacent.

Exit: the approved scope, reference matrix, caller/test inventory and exclusions
are reviewable. No test success is implied by this planning exit.

## Phase 1: relocate execution without changing policy

Move the existing Respondant cursor, progress, transport activity and cleanup
ownership into Poster. Respondant retains interpretation, routing preparation and
reply publication. Preserve current ordering, finite-pass scheduling, source
removal, preparation, exact-packet retry and completion behavior.

Retain current `ReplyCursor`/prepared-packet state during this ownership move.
Do not hide phase 3's FIFO/failure-policy change inside a structural refactor.
Narrow raw cue interpretation and remove unused witness collection in a later
focused cut after the ownership-only cut, while keeping meaningful assertions.

Exit: existing protocol, failure, cancellation and cleanup regressions pass through
the new owner. Any test adjustment follows ownership rather than weakens an
independent behavior assertion. Protocol behavior remains the same, while public
execution/lifecycle methods move from Respondant to Poster without compatibility
wrappers; package changes must record that API impact.

## Phase 2: one Poster queue and concrete outcomes

Route every Poster execution path through `evts`, with one independently running
host worker. Migrate exchanges, credentials, multisig, delegation, challenge and
OOBI callers. Construct EXN protocol messages outside Poster. Remove the alternate
immediate-send path; callers needing completion observe their concrete event's
optional success/failure outcome rather than drain shared work.

Outcomes identify a queue operation, not merely its SAID: resending the same signed
message must not inherit an earlier success. Request-owned HTTP/TCP response
streams retain their own lifetimes. Ingress publishes outbound work and does not
run the postman worker. QueryCoordinator's separate delivery path is unchanged.

Exit: caller inventory is reconciled; queued and immediate execution cannot
bypass one another; reused SAIDs, independent host progress and request cancellation
have direct coverage. No successful local send is reported as remote acceptance.

## Phase 3: ordinary records and explicit failure ownership

Eagerly prepare all KEL/TEL replay messages and all records for a source cue or
correlated batch before removing its source. Publication is atomic at this
in-memory boundary: failure while preparing a later message or the second TSN
reply leaves the complete source available and publishes no partial batch.

Delete `ReplyCursor`, `CueEmission`, wire/notify/transport wrappers, manual
message/target indices, cross-batch scheduling state and retained final-wire retry
state. Traverse FIFO events and their destinations sequentially with ordinary
loops. This deliberately changes latency: a large replay can delay a later short
reply. Eager queued replay also trades lazy consumption for finite materialization;
there is no memory bound or fairness guarantee.

For an observed destination refusal, continue the event's remaining destinations.
Retain the **whole event**, including partial delivery results, in `failures` when
the attempt is unsuccessful. Do not automatically retry it. Explicit retry uses
the original signed source message, refreshes routes, forwarding envelopes and
introductions, and may duplicate delivery to destinations that already succeeded.
Explicit discard releases the retained failed event. Failure records are ephemeral.

Remove witness emission snapshots when production callers discard them. Route
notifications and mailbox work from their existing cue types. Preserve the actual
observable effects in tests instead of collecting unused output to satisfy them.
Unrouted but authorized direct HTTP replies remain valid; source authorization,
correlation, TSN order, and independent response consumption stay unchanged.

Exit: no hidden auto-retry, manual reply cursor or alternate Poster path remains.
Atomic preparation, partial failure, explicit retry/discard, refreshed routing,
duplicate delivery and independent direct responses have meaningful coverage.

## Phase 4: qualify transport completion and failure containment

Compare the actual GLEIF delivery lifecycle and test local TCP drain separately
from connection cleanup and a later reset. Preserve duplex receive behavior and
half-close semantics; the queued sender must not claim a remote application ACK.

HTTP delivery succeeds only after the successful response body completes, not
when headers arrive. Truncation and non-2xx outcomes fail. Do not add automatic
redirect, reconnect or replay. Contain known endpoint/transport failures in their
event outcomes. Retain work before propagating unexpected construction, storage,
parser or cleanup failures; do not turn those into benign remote refusals.

Exit: scoped lifecycle tests, relevant composed interop and package/static checks
pass at the candidate revision, or the remaining failures are explicit blockers.
Historical release evidence is not new-head qualification.

## Caller inventory

Reconcile this list against source at each phase; listed files are starting points,
not permission to change adjacent workflows.

| Boundary                           | Current source                                                                                           | Required review                                                                        |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Construction and queue publication | `core/cues.ts`, `app/habbing.ts`, `app/respondant.ts`, `app/cue-runtime.ts`                              | Cue typing, atomic preparation, source removal and reply correlation                   |
| Execution and host lifetime        | `app/forwarding.ts`, `app/agent-runtime.ts`, `runtime/index.ts`                                          | One worker, outcome identity, convergence, close and public exports                    |
| Witness input                      | `app/witnessing.ts`                                                                                      | Discarded collections, actual receipt effects, request-owned input cleanup             |
| HTTP input/output                  | Tufa `http/protocol/runtime-bridge.ts`, `http/protocol/endpoints/generic-cesr-ingress.ts`                | Publish without draining shared outbound work; preserve final-query/TSN authorization  |
| TCP witness host                   | Tufa `host/witness-tcp.ts`                                                                               | Direct response lifetime, duplex behavior and raw cue interpretation                   |
| Domain producers                   | Exchange/credential, multisig, delegation, challenge and OOBI producers found by Poster call-site search | Construct messages outside Poster; opt into concrete outcomes where completion matters |
| Query correspondence               | `app/querying.ts`                                                                                        | Preserve separate QueryCoordinator ownership and tests                                 |

## Test inventory and acceptance

Reuse maintained tests and topology. Do not retain turn-count expectations merely
to preserve the former scheduler, and do not replace protocol assertions with
implementation-shape checks.

| Test owner                                                                                      | Independent behavior to preserve or add                                                                                                                 |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/keri/test/unit/app/cue-runtime.test.ts`                                               | Preparation/source retention; exact retry during phase 1; iterator and joined-I/O cleanup; later explicit failure semantics                             |
| `packages/keri/test/unit/app/query-replies.test.ts`                                             | Correlation isolation, atomic TSN pair publication, independent direct/outbound consumers, sender-state and cleanup boundaries                          |
| `packages/keri/test/unit/app/runtime-responder.test.ts`                                         | Correct reply/mailbox routing, accepted witness effects, unrelated ingress progress and no unnecessary output collection                                |
| `packages/keri/test/unit/app/reply-streams.test.ts`                                             | EOF/cancellation, primed responses, iterator return and cleanup error identity                                                                          |
| `packages/keri/test/unit/app/forwarding.test.ts`                                                | Direct/witness/mailbox route selection, exact CESR authentication, partial destinations and final event outcomes                                        |
| `packages/keri/test/unit/app/query-runtime.test.ts`, `reactor-turn.test.ts`, `querying.test.ts` | Accepted-state completion, source ownership and unchanged query correspondence                                                                          |
| `packages/keri/test/unit/app/witness-runtime.test.ts`                                           | Receipt authorization, KEL catchup, query replay and actual witness transport                                                                           |
| `packages/tufa/test/runtime-bridge.test.ts`, `progressive-ingress.test.ts`                      | HTTP caller migration, concurrent reservations, final-query selection, full TSN pair and cancellation                                                   |
| Scoped exchange, credential, multisig, delegation, challenge and OOBI owners                    | Queued publication plus concrete operation completion through the composed host                                                                         |
| Scoped TCP/HTTP lifecycle and relevant interop owners                                           | Drain versus later reset; half-close/duplex RX; complete/truncated/non-2xx HTTP bodies; known failure containment versus unexpected failure propagation |

New direct cases must cover reused-SAID outcome identity, eager replay failure
before publication, FIFO ordering, no automatic retry, all-target attempts after
refusal, retained partial outcomes, explicit retry/discard, refreshed routing and
possible duplicate sends. Phase 1 must first preserve the existing behavior;
later phases deliberately replace only assertions contradicted by the approved
new contract.

Record checks against the actual candidate, including failures and unrun owners.
Run the smallest falsifying checks first, then relevant suites, static checks and
changeset validation. Broader release qualification remains a separate obligation.

## Progress

- Phase 0: plan and inventories saved; baseline source inspected.
- Phase 1: ownership relocation implemented; 44 focused tests passed locally.
  Final candidate checks and CI remain pending; this is not broader release qualification.
- Phases 2–4: approved follow-up scope; not implemented or qualified by this cut.

The owning contracts are [cues](../../design-docs/runtime/CUES.md),
[ingress/egress](../../design-docs/runtime/INGRESS_AND_EGRESS.md) and
[query/reply](../../design-docs/runtime/QUERY_REPLY.md). Update their present-tense
claims only when the corresponding phase is implemented and checked.
