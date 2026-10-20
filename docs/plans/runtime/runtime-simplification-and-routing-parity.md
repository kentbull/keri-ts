# Runtime simplification and KERIpy routing parity

Status: active implementation plan. Edit this document only when scope, contracts,
source decisions or acceptance gates change. Git commits, PR descriptions and CI
own progress, completed phase evidence and delivery chronology.

Inspected baseline: clean local `master` at
`20da8bad16f3ef09fd82846bb8d050fbd2184afa`, after local mailbox consumption removal
in #556. Recheck the checkout and source before execution; do not reset independent
work to this historical revision. Work in the existing local repository without
additional worktrees.

## Objective and governing decisions

Remove unsupported runtime mechanisms and replace the TypeScript-specific routing
policies with the corresponding production KERIpy behavior. Keep the protocol,
authorization, completion and resource-lifetime behavior required by actual callers.

Follow the workspace's `enctx/adrs/ten-constraints.md`, SOLID and
[ADR-0013](../../adr/adr-0013-simple-component-flows.md). Establish ownership and
contracts before changing behavior. Prefer ordinary concrete operations and records;
do not introduce a framework to replace the machinery being removed.

The accepted rules are:

- No compatibility with previous keri-ts APIs, flags, routing policies or data
  shapes is required. Remove obsolete exports and callers together. Add no aliases,
  deprecated wrappers, migration readers, fallback switches or compatibility modes.
- KERIpy wire interoperability, including required v1/v2 bridges, remains required.
- A test driver does not establish a product requirement. Remove test-only
  mechanisms without a production KERIpy counterpart or a demonstrated useful
  improvement. Delete their mechanism-only tests as well.
- Preserve independent protocol, authorization, ordering, failure and cleanup
  assertions by exercising the remaining application paths. Do not weaken test
  topology or delete valid assertions merely because their fixtures use retired APIs.
- HTTP, clock, store and protocol collaborators remain explicit constructor or
  function dependencies. No service bags, injectable polling strategies, generic
  routing strategies, callback-bearing delivery records or logging framework.
- Maintain concise human-readable documentation for touched classes, constructors,
  public/private functions, parameters, members and contract-bearing records.
  Explain ownership, completion, cancellation and failure boundaries; comment
  consequential ordering rather than narrating assignments. Document actual behavior.
- Poster receives resolved destination AIDs and prepared signed messages. Producers
  resolve aliases and construct application messages. Delivery remains queue-driven.
- Retain actual completion waiters and concrete-event matching. Admission does not
  establish delivery; delivery does not establish remote protocol acceptance.
- Remove both retry and discard APIs. Removal of the retained failure backlog is a
  separate behavior change, gated on a concrete unobserved-failure reporting policy.
- Preserve the approved GLEIF-derived transport completion, failure containment,
  cancellation and joined cleanup. Routing parity must not restore known hangs or
  conflate cleanup errors with peer refusals.

## Reference authority and known discrepancies

Use these exact source revisions, inspected from local Git objects:

- Routing and production caller correspondence:
  [KERIpy 71438328](https://github.com/WebOfTrust/keripy/tree/7143832813cac6a394ab1faf9be83bb3372be87c).
- Messenger completion and failure containment:
  [GLEIF-IT KERIpy b8626e1d](https://github.com/GLEIF-IT/keripy/tree/b8626e1d58770a4a480ea72a01acc5580278a9f2).

These references are not interchangeable. The routing baseline prefers HTTPS,
then HTTP, then TCP in messenger factories. The GLEIF revision prefers HTTP before
HTTPS. Use the routing baseline's preference, while retaining the previously
qualified GLEIF lifecycle improvements. This is an explicit source selection, not
a configurable policy.

The review established source-code behavior and reachable application paths, not
private production deployments. Unknown external API consumers are not evidence
for retaining unsupported keri-ts compatibility.

### Explicit source issues to settle before the routing PR

1. **Cut endpoint records:** both reference `endsFor` methods enumerate records
   without checking authorization flags. `/end/role/cut` pins a record with
   `allowed=False` rather than deleting it. Preserve enforcement of accepted
   authorization; do not revive cut roles for textual parity. Check the existing
   TypeScript `allowed || enabled` rule against its actual authorization contract
   before modifying that rule. Record the exact exception and regression evidence.
2. **Empty location maps:** KERIpy preserves endpoint entries without URLs, whereas
   TypeScript drops them before routing. Preserve the selected role's identity and
   report missing/unsupported locations at endpoint execution; do not silently
   promote a lower-priority role or another endpoint to hide configuration failure.
   Local provider storage must not require a network URL for a local endpoint.
3. **StreamPoster mixed-role envelopes:** `send()` can construct `/fwd` merely
   because a mailbox role exists, then `_chunk()` selects a controller role. Its
   early local-storage check also receives a role map where it expects endpoint
   IDs. GLEIF additionally differs in returned attachment bytes. Separate the real
   endpoint-selection contract from these construction defects. Before porting,
   record a concrete wire decision and proof: direct targets receive the appropriate
   source stream; indirect targets receive forwarding material; local storage keeps
   recipient payloads. Do not silently claim literal donor wire parity for a fix.

Phase 0 must make these exceptions concrete and reviewable before the routing
implementation. If source review exposes a genuinely unresolved protocol decision,
isolate it and obtain Kent's decision rather than inventing policy. Independent
removal phases may continue. Do not modify Python repositories as part of this plan.

## Removal and preservation inventory

| Area                        | Evidence at the inspected baseline                                                                               | Target                                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| MailboxPollTransport        | One production adapter; only alternate implementation is FakeMailboxPollTransport                                | Remove interface, adapter, constructor plumbing, exports and fake; call the concrete HTTP/SSE operation with HTTP and clock  |
| Reactor queued ingress      | No in-tree application producer; ingestKeriBytes is unused; OOBI and other intake await processing directly      | Remove ingress Deck, ingest, hasIngress, clearIngress, processOnce, msgDo, wrapper, idle worker and queue-only pending state |
| Delivery preference         | indirect equals auto; observed direct-script scenarios already route directly from controller endpoints          | Remove auto/direct/indirect, corresponding types, CLI flags, normalization and argument propagation                          |
| Mailbox-only query fallback | Dedicated fake-HTTP test proves URL selection, not provider response acceptance; no donor counterpart            | Remove invented controller attester and mailbox URL fallback, plus its dedicated test                                        |
| Poster alias ownership      | Nine application call sites; matching Python command-side resolver                                               | Move resolution to existing Organizer/application boundary; remove Poster.organizer and resolveRecipient                     |
| Route/preparation API       | resolveBytesRoute has test-only callers; findBytesRoute and prepareBytesTarget have actual internal callers      | Delete wrapper; internalize concrete routing/preparation and simplify arguments to resolved AIDs                             |
| Poster retry/discard        | Only tests call these; no application recovery consumer                                                          | Remove both APIs and recovery-specific tests; preserve failure outcomes                                                      |
| Failure backlog             | No application reader; unobserved Respondant failures currently retain their only terminal evidence here         | Keep during structural removals; remove only in the separately gated failure-reporting phase                                 |
| Routing deltas              | Mailbox-first suppression, broadcast-all mailboxes and sorted-first selection differ from donor production flows | Replace with the owner-specific routing matrix below                                                                         |
| Poll target precedence      | Current mailbox presence suppresses witnesses; both Python references poll both sets by default                  | Remove precedence; preserve distinct provider cursors and per-endpoint lifetimes                                             |

Actual aliases, provider mailbox storage, remote mailbox polling, direct input,
input-specific Kevery/parser ownership, shared ProtocolProcessor serialization,
query continuations, request-owned reply correlation, response streams, source
signatures, media fallback and real network cleanup remain.

## Required routing contracts

### Ordinary Poster

- Inspect the accepted endpoint-role map for the recipient.
- If controller, agent or mailbox roles are present, traverse them in that order.
- Deliver to every endpoint within each present controller and agent role.
- For the mailbox role, if a provider store exists and any eligible mailbox EID
  belongs to the local prefix set, store locally. Otherwise select one mailbox
  randomly and forward. Do not broadcast to every mailbox.
- Only when those three roles are absent, use the witness role, with the same local
  provider shortcut or one randomly selected witness.
- Role selection is not network failover. Preserve actual failure outcomes; do not
  retry another randomly selected candidate or switch schemes after refusal.
- Local storage is provider publication. It must not restart local mailbox scanning
  or feed stored rows automatically into recipient protocol handlers.

### StreamPoster-corresponding operations

- Preserve the first-present-role order controller, agent, mailbox; use witness
  only when those roles are absent.
- Deliver to all endpoints of the chosen direct role, or select one mailbox/witness
  with the local-provider shortcut where applicable.
- Preserve one operation's source order and endpoint-selection boundary across its
  prepared stream/batch. Do not choose a fresh random endpoint for every constituent
  frame if the donor operation selects once for that stream.
- Represent this real production distinction through the smallest concrete
  operation/admission contract. Do not infer it from EXN route/topic, expose it as a
  new user mode, add a generic strategy interface, or restore an immediate-send path.
- Before implementation, specify how this operation shares queued execution and
  completion ownership with ordinary sends. Do not add cursor state, fairness,
  automatic retry, lazy queued replay or a class solely for Python naming parity.

### Query selection

- Ordinary inquiries use the first eligible role: controller, agent, witness.
- Randomly select one endpoint within that role. A supplied alternative-witness
  list selects one supplied witness, using that witness's location records.
- Preserve explicitly addressed single-attester requests and signer/attester/subject
  distinctions. A missing selected location remains a visible routing failure.
- Remove sorted-first preference and the mailbox-only controller-query fallback.
- Preserve AnchorQuerier's separately justified queries to each recovery candidate;
  do not turn this into one random inquiry while changing ordinary selection.

### Mailbox poll selection and transport schemes

- Poll every allowed mailbox provider and current KEL witnesses when witness
  polling is enabled, as in the donor's default MailboxDirector behavior.
- Keep remote progress keyed by subject, provider and topic. Multiple provider
  histories are not interchangeable. Preserve group-member signing and consumer
  completion before cursor advancement.
- Audit local endpoint exclusions and an EID appearing in both role sets explicitly;
  do not inherit a TypeScript precedence or invent duplicate workers accidentally.
- Messenger URL choice is HTTPS, then HTTP, then TCP for the selected reference.
  HTTP mailbox polling requires HTTPS or HTTP. Unsupported schemes are errors,
  not permission to select the first arbitrary recorded URL.
- Audit uses of shared URL helpers before editing them: display, OOBI, admin and
  delivery callers must not receive unintended policy changes through one utility.

### Producer-to-reference map

| Production workflow                                                           | Reference owner |
| ----------------------------------------------------------------------------- | --------------- |
| Respondant receipts, KEL/TEL replay and replies                               | Ordinary Poster |
| Challenge response, generic EXN, OOBI introduction/sharing                    | Ordinary Poster |
| Delegation requests, confirmation and replay                                  | Ordinary Poster |
| Ordinary multisig and credential/registry creation or revocation work         | Ordinary Poster |
| Endpoint role/location publication                                            | Ordinary Poster |
| Initial IPEX grant, admit and spurn, including corresponding member proposals | StreamPoster    |
| IPEX join member signaling and completed recipient output                     | Ordinary Poster |

The same `/ipex/grant` may therefore use different donor operations when initially
produced versus completed by join. Current shared IPEX helpers must retain that
producer context. IPEX apply/offer/agree are nonce-printing CLI stubs in this reference; their
real TypeScript implementation can use ordinary generic-EXN routing, explicitly
labeled as supported behavior rather than an exact donor workflow port. Do not add
a missing watcher command merely because the reference uses StreamPoster there.

## Cohesive implementation phases

Each substantive phase is a cohesive commit/PR boundary. Keep one PR active at a
time, merge after its scoped gates, then start the next from verified local master.
Split a phase only at a real ownership or behavior boundary; no temporary shims
merely to manufacture smaller PRs. This plan's preparation makes no commits.

### Phase 0 — Freeze the caller and parity contracts

- Recheck baseline, applicable instructions, live callers, exports and tests.
- Turn the producer map into an exact symbol/call-site matrix, including initial
  IPEX versus join paths and the nine alias callers.
- Close the reference discrepancies above with source and meaningful regression
  expectations. Define the ordinary/stream admission representation and batch
  selection boundary before changing routing.
- Inventory tests as retain, move to supported path, or delete; do not use current
  test counts as a preservation requirement.
- Record the failure-backlog gate separately; it does not block independent cuts.

Exit: no unresolved source choice or hidden routing mode remains in the routing
design. Include this plan and resulting matrix in the first implementation PR.

### Phase 1 — Remove the redundant mailbox transport seam

- Delete MailboxPollTransport/httpMailboxPollTransport and their public and
  composition plumbing. Remove or internalize the request record as warranted by
  the concrete function's actual inputs.
- Keep explicit HTTP/clock collaborators and the current per-attempt Effection
  scope. Await each consumer before publishing the remote cursor.
- Remove FakeMailboxPollTransport and injection-only assertions. Exercise useful
  topic, signer, endpoint, deadline and cleanup cases through real HTTP/SSE handling
  with the existing fake HTTP client/manual clock.
- Preserve routing and poll-target policy during this ownership-only phase.

Exit: all application roots compose fewer dependencies, and existing real mailbox
behavior passes without a replaceable polling-operation strategy.

### Phase 2 — Remove dormant Reactor queueing

- Delete the queue methods/state, unused ingestKeriBytes wrapper, unconditional
  msgDo worker and queue-only convergence/close bookkeeping.
- Preserve process/processBytes, input Kevery, shared protocol processing and
  cancellation-aware source cleanup.
- Move meaningful tests from ingest/processOnce to awaited input; delete queue
  copy, removal/reinsertion and idle-worker mechanics tests.
- Correct stale OOBI queue claims. Preserve independent active-work completion
  predicates; removing a queued-input flag must not claim active I/O is finished.

Exit: every remaining runtime worker has an actual application producer/owner,
and direct/OOBI/mailbox intake still reaches accepted state with joined cleanup.

### Phase 3 — Narrow Poster and remove unsupported recovery APIs

- Move alias resolution to a small existing-layer helper and migrate all nine
  callers. Keep known-AID precedence and missing/ambiguous-alias errors.
- Delete resolveBytesRoute; internalize real route/target construction. Stop
  exposing internals merely for test monkeypatching.
- Remove retry/discard and their dedicated tests. Keep admission copying and
  original signed-source integrity assertions on actual send paths.
- Preserve failures temporarily, plus concrete success/failure outcomes, partial
  deliveries, exact causes, later-target/later-event progress and unexpected-error
  propagation. The process-local backlog still releases on close; do not replace
  discard with a new alias or recovery control.
- Preserve routing behavior until the next phase; migrate tests to accepted
  endpoint state and supported admission/execution instead of private method access.

Exit: Poster accepts resolved destinations and source messages; application alias
behavior remains; no retry/discard or public preparation mechanism survives.

### Phase 4 — Replace TypeScript routing and delivery modes

- Implement the approved owner-specific ordinary/stream contracts and producer map
  through the queued execution path, using simple role/target loops.
- Remove auto/direct/indirect throughout types, callers, scripts, CLI help,
  documentation and tests. Do not make direct-only delivery the new default.
- Remove mailbox-first direct-role suppression and broadcast-all-mailboxes.
- Restore random mailbox/witness/ordinary-query selection and selected-reference
  scheme behavior. Remove unsupported mailbox-only query routing.
- Poll allowed mailbox providers and witnesses together under the corresponding
  policy, without resurrecting local DB consumption.
- Preserve authorization, forwarding framing, independent child signatures,
  request correlation, delegation gates and transport cleanup. Apply only the
  explicit donor-defect corrections resolved in Phase 0.
- Remove tests of old policy. Add behavioral parity cases with real endpoint state.
  Test randomness without a production strategy hook or flaky distribution claims.

Exit: every affected workflow names its donor owner and meets the routing matrix;
mixed-role and multi-provider tests prove actual delivery/intake, not just a URL
captured by a fake. No obsolete modes or hidden compatibility behavior remain.

### Phase 5 — Decide and implement unobserved-failure reporting separately

This phase begins with a concrete contract review, before deleting the backlog.
Retained failure records have a real GLEIF correspondence; lack of a retry caller
does not justify silently deleting Respondant's only terminal failure evidence.

- Identify each observed send and each unobserved producer, especially Respondant
  sendAll. Specify who sees an expected refusal or missing route, when, and with
  which source/destination/topic, cause and partial-delivery context.
- Preserve waiter outcomes and their consumption/cancellation semantics. Keep
  failures out of pending/idle calculations.
- Specify a concrete reporting action at the actual delivery/application owner
  for unobserved failures. Ordinary diagnostics around domain work are permitted;
  no logging wrapper, reporting framework, generic callback, or replacement unused
  queue may become an architectural dependency.
- State that removing retention releases failed source bytes after reporting and
  provides no later retry/recovery guarantee. Do not log raw message/key material.
- Only after that contract is reviewable and its meaningful tests are identified,
  remove the backlog and tests devoted solely to its storage/recovery behavior.
- Preserve progress after recognized refusals and propagation of unexpected
  construction, storage, parser and cleanup faults.

Exit: awaited failures reach their callers, unobserved failures remain visible,
and the owner retains no unused recovery history. If no acceptable reporting
contract is established, leave the backlog intact and report this phase unfinished;
do not describe the whole plan as complete.

### Phase 6 — Reconcile and qualify the final design

- Review complete cue, query, forwarding/mailbox, IPEX, delegation and finite CLI
  flows against source and tests.
- Reconcile runtime contracts, QUERY_REPLY, CUES, mailbox design, ADR-0009,
  ADR-0013, relevant learnings and plan routing.
- Correct ADR-0009's already-stale local replay/bounded batch claims; rewrite its
  former mailbox-first policy as superseded. Do not describe planned behavior as
  implemented before its phase lands.
- Update the reliability roadmap to distinguish historical retry/retention
  decisions from the new implemented contract. Preserve accurate historical evidence.
- Run final composed qualification after the implementation PRs are merged, per
  the validation discipline below, and repair failures before completion.

Exit: source, docs and current qualification agree; all phase gates, including
unobserved-failure reporting, are complete or explicitly outstanding.

## Validation and test disposition

Use existing focused owners first, then affected composed scenarios. No new tests
for prose or new documentation lint/coverage infrastructure.

| Change                    | Required evidence                                                                                                                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Concrete mailbox polling  | Real header/SSE timeout paths, one-millisecond minimum, group signer, per-provider cursor, consumer failure/cancellation and joined reader cleanup                                                    |
| Reactor queue removal     | Direct protocol acceptance, OOBI intake, independent progress while OOBI is blocked, parser/consumer cancellation, store closure after active work                                                    |
| Alias relocation          | All nine callers migrated; exact known AID, unique alias, absent and ambiguous alias behavior                                                                                                         |
| Poster API reduction      | Real wire/forwarding construction, admitted signed bytes, partial delivery, subsequent targets/events, original unexpected errors                                                                     |
| Completion                | Same-SAID repeated sends and different recipients remain independent; cancellation drops observation; consuming outcomes does not alter idle; delegation gates wait for success                       |
| Ordinary routing          | Controller+agent+mailbox role traversal, every direct endpoint, one mailbox, local provider shortcut including a local EID different from sender, witness-only fallback                               |
| Stream routing            | Actual initial IPEX versus join owners, first-role selection, source ordering and one selected relay or one stable selected direct-endpoint set per corresponding batch, mixed-role wire construction |
| Query routing             | Role priority, one eligible random endpoint, explicit witness sets/single attester, missing location, no mailbox-only fallback; preserve anchor recovery                                              |
| Poll targets              | Mailboxes and witnesses together, multiple independent histories, group subject/signing member, authorization cuts and repeated endpoint identities                                                   |
| Schemes and authorization | HTTPS/HTTP/TCP priority at actual owners, unsupported/empty locations, cut endpoints excluded, no hidden scheme/endpoint retry                                                                        |
| Failure history removal   | Concrete observed failure and one visible unobserved terminal report, context/cause/partial-success preservation, no retained recovery history or false success                                       |

Relevant existing suites include mailbox-poller-runtime, mailbox-sse,
mailbox-director-lifecycle, reactor/reactor-turn, runtime store ownership,
forwarding, poster-queue, cue-runtime, query-replies, querying, challenge direct
and mailbox, Tufa runtime-bridge, CLI and ingress tests. Use maintained
witness/query, mailbox, delegation, multisig/IPEX, Sally interoperability and
installed-package owners where their flows change. Preserve their participant
topology; flags disappearing does not justify shrinking the scenario.

Delete assertions whose sole contract is injected poll strategies, dormant ingress
queues, direct-only overrides, mailbox-only query inventions, sorted-first/all-mailbox
policy, public preparation snapshots or explicit retry/discard. Preserve independent
protocol assertions from mixed tests at their real application boundary.

For each PR:

- Run formatting, lint, quality/type and changeset checks, plus relevant link checks.
- Use [scoped CI](../../reference/PR_TEST_SCOPE.md), exact-head local-test credit
  where supported, and relevant integration/package groups. Do not claim unrun tests.
- Record public API/CLI removals as release-impacting changesets for affected
  packages; do not disguise them as readability-only changes. Documentation-only
  reconciliation uses an empty changeset when delivered separately.
- Use human-oriented cohesive commits and reviewer reading order. Verify the exact
  pushed head and required checks before merging. Attach every created PR.
- Run ENCTX index maintenance after final file/Git mutations before every handoff;
  require healthy output and no stale sources.

Do not run the whole suite after every cut. Run the maintained full suite and
composed interoperability/package qualification once after the final implementation
merge, consistent with the previously agreed end-of-sequence qualification. Publish
exact revisions and limits. Do not publish a package release as part of this plan.

## Explicit exclusions and completion standard

No new LocalMailboxReader, automatic retry/backoff, durable delivery intent,
acknowledgement protocol, per-target recovery cursor, fairness scheduler, lazy
queued replay, resource-budget policy, alternate routing configuration, generic
messenger hierarchy or logging architecture.

Completion means the agreed machinery and its unsupported tests are gone; real
application behavior is preserved or deliberately changed to the recorded donor
contract; source exceptions are explicit; failure visibility survives removal;
docs and qualification agree; and each cohesive implementation PR is merged.
An empty caller search, reduced line count or a green fake-only test is insufficient.
