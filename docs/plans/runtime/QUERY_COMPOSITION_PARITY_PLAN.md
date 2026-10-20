# Query composition parity with KERIpy

Status: approved release-goal supplement; implementation and qualification pending.
Date: 2026-10-20.

## Decision

Replace our general query coordinator and direct HTTP query-response extension
with KERIpy-shaped query senders, concrete query workflows, and independently
composed receive owners. Delete the old APIs rather than preserve aliases,
configuration switches, adapters, or dormant implementations.

The target is a recognizable responsibility model, not a transliteration of HIO
into TypeScript. Effection scopes own running operations and cleanup. KERI/ACDC
processors and their databases remain the authorities for accepted state.

This plan supersedes the instructions to retain query-owned HTTP CESR/SSE intake
in `MESSENGER_SELECTION_PARITY_PLAN.md`. It does not supersede that plan's
ordinary POST / whole-stream PUT distinction or its TCP requirements. Land as
PRs 13e–13g after messenger qualification and the reporting/layering cut 13d,
before durable proposal resume and expanded credential lifecycle work.
Reconcile the inspected source against the execution head before implementation.
The [release plan](../V2_RELEASE_COMPLETION_PLAN.md) owns ordering. Its existing
PR 19 supplies old-peer mailbox media fallback before 13f, so independent
receivers can retrieve legacy replies when direct HTTP response intake is removed.
Keep that fallback in the mailbox owner; do not duplicate it in query sending.

No compatibility with older keri-ts APIs or its custom HTTP query behavior is
required. Preserve protocol interoperability with KERIpy main and v1 peers.

## Source basis and current findings

Inspected keri-ts HEAD: `5d691345b8a6aa37856ea100f867efb323ceb91f`.
PR #604 head: `b799ac8536f58e404187b84ff63cd1efa5d74913`.

Reference implementations:

- KERIpy main: `424a50c03421165c5f289e07a341bd57b8d8ab78`.
- Original inspected KERIpy 1.2.14: `bab95c16e949b61398129a3e41a8f68bad84c94f`.
- Approved 1.2.x execution target: GLEIF-IT/keripy v1.2.17,
  `b8626e1d58770a4a480ea72a01acc5580278a9f2`, with `gleif-hio==0.6.21`.
  Reinspect the query paths there; do not label old-pin findings as its results.
- KERIpy 1.3.6: `4ce4cc79e06653f77342be1bf604086b89b1f090`.

Primary source map:

| KERIpy source                                                                                                                                                   | Relevant responsibility                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [agenting.py: WitnessInquisitor](https://github.com/WebOfTrust/keripy/blob/424a50c03421165c5f289e07a341bd57b8d8ab78/src/keri/app/agenting.py#L441)              | Resolve target, construct signed query/introduction, send using ordinary messenger |
| [agenting.py: TCPMessenger and HTTPMessenger](https://github.com/WebOfTrust/keripy/blob/424a50c03421165c5f289e07a341bd57b8d8ab78/src/keri/app/agenting.py#L680) | TCP parses same-socket input; HTTP collects transport responses                    |
| [querying.py](https://github.com/WebOfTrust/keripy/blob/424a50c03421165c5f289e07a341bd57b8d8ab78/src/keri/app/querying.py)                                      | Key-state, sequence, log, and anchor workflows                                     |
| [indirecting.py: MailboxDirector](https://github.com/WebOfTrust/keripy/blob/424a50c03421165c5f289e07a341bd57b8d8ab78/src/keri/app/indirecting.py#L461)          | Compose polling, input processing, and escrows                                     |
| [indirecting.py: Poller](https://github.com/WebOfTrust/keripy/blob/424a50c03421165c5f289e07a341bd57b8d8ab78/src/keri/app/indirecting.py#L731)                   | Signed `mbx` POST, SSE reception, topic cursors                                    |
| [indirecting.py: HttpEnd](https://github.com/WebOfTrust/keripy/blob/424a50c03421165c5f289e07a341bd57b8d8ab78/src/keri/app/indirecting.py#L922)                  | Non-mailbox query returns 204; mailbox query returns SSE                           |
| [storing.py: Respondant](https://github.com/WebOfTrust/keripy/blob/424a50c03421165c5f289e07a341bd57b8d8ab78/src/keri/app/storing.py#L259)                       | Publish replay/reply evidence through Poster                                       |
| [cli/commands/query.py](https://github.com/WebOfTrust/keripy/blob/424a50c03421165c5f289e07a341bd57b8d8ab78/src/keri/cli/commands/query.py#L55)                  | Compose query workflow and mailbox receiver under a command deadline               |

Both inspected v1 `HttpEnd.on_post` implementations also distinguish ordinary
query 204 from mailbox-query SSE.

Current TypeScript findings:

1. `app/http-query.ts` owns direct HTTP CESR parsing and a custom bounded SSE
   query window. #604 extracted this existing behavior from `HTTPMessenger`.
2. `app/querying.ts::QueryCoordinator` combines signer/endpoint resolution,
   unsigned requests, retained signed packets, network lifetime, and a generic
   `QueryContinuation` registry with `observe`/`tick` callbacks.
3. `agent-runtime.ts` starts separate preparation and delivery loops for that
   coordinator. `cue-runtime.ts` forwards all cues to its observers.
4. `app/cli/query.ts` adds a controller-OOBI catch-up fallback after the query
   deadline. That can conceal failure of the actual query/reply workflow.
5. Tufa `http/protocol/endpoints/generic-cesr-ingress.ts` implements optional
   direct replies, a 60-second deferred wait, and reservations that divert cues
   from normal publication. Agent hosting enables `directQueryResponses`.
6. Existing mailbox/witness hosts and tests already exercise ordinary 204 plus
   mailbox delivery. This refactor can consolidate on that working composition.
7. Our `MailboxDirector` is primarily provider/topic/cursor infrastructure;
   it is not an exact copy of Python's receiver. Existing recipient intake is
   `forwarding.ts::MailboxPoller` -> `settleMailboxPollBatch` -> `Reactor`.
8. `QueryReplies` is also used by the real TCP host. `ReplyStreams` also serves
   OOBI and witness HTTP endpoints. Neither is globally dead after HTTPQuery
   removal.
9. CLI/delegation callers use `watchKeyState`, `watchSeqNo`, `watchAnchor`, or
   enqueue query instructions. OOBI and protocol escrows emit recovery cues.
10. Existing anchor recovery deliberately asks multiple known candidates to
    survive a retired witness. That is a separate, tested policy decision.

## Target composition

```text
Concrete query workflow / protocol recovery cue
  -> WitnessInquisitor -> ordinary messenger -> remote query ingress

Remote Respondant -> Poster -> requester endpoint or mailbox
  -> existing receiver -> protocol processors -> committed state / cues
  -> query workflow's completion predicate
```

### WitnessInquisitor owns sending

Introduce the concrete KERIpy-named sender in a cohesive application module.
Retain existing typed query instructions; do not invent a generic request bus.

- Resolve the selected local signer and remote attester, construct/sign the query
  and introduction synchronously, then run the actual transport operation.
- Keep one ordinary pending request Deck and the currently executing attempt.
  Remove the separate retained signed-packet delivery backlog and its retry
  contract in the behavior cut. No outbox, delivery history, retry API, or
  automatic resend of a failed attempt.
- Use ordinary messenger construction: HTTP POST, never stream PUT for queries.
  HTTP transport completion does not parse evidence or mean query completion.
- Keep a real TCP receive owner for same-socket replies. The existing
  transmit-only `messengerFrom` path alone is insufficient for TCP queries.
  Compose the existing duplex TCPMessenger with its receive dependencies;
  do not force protocol/Kevery dependencies into HTTP sending.
- Reuse actual HTTP and TCP resource scopes, cancellation, native failures, and
  joined cleanup. No replacement cancellation framework or synthetic lifecycle.
- A finite caller observes failure from its operation. A background sender
  reports a failed attempt once at its owner and continues unrelated work for
  expected transport failures; unexpected faults propagate. Never count a
  failed introduction or an earlier response as the current query's success.
- Deferred incomplete recovery instructions may wait for signer/endpoint
  evidence without sending. Distinguish that from retrying failed network work.
  Malformed instructions and unusable explicitly selected endpoints fail visibly.

Retain explicit signer selection and the no-guessing rule for multiple local
identities. Keep local signer, queried subject, and remote attester distinct.
Ordinary role selection remains controller, agent, witness, choosing one eligible
endpoint; preserve authorized-role filtering and explicit witness overrides.
Do not introduce mailbox-as-attester fallback or alternate-endpoint failover.

### Query workflows own semantic completion

Keep `KeyStateNoticer`, `LogQuerier`, `SeqNoQuerier`, and `AnchorQuerier` as
concrete scoped operations/components corresponding to KERIpy's doers.

- Remove `QueryCoordinator`, its `watch*` registry, and `QueryContinuation`.
  Do not rename that entire abstraction to `WitnessInquisitor`.
- Each workflow owns its initial request, state/cue observation, follow-on work,
  and termination. `KeyStateNoticer` requests KSN and composes `LogQuerier` when
  accepted remote state shows missing local events.
- Supply explicit accepted-state access, selected signer, and query-sending
  capability. Workflow owners may construct scoped inquisitors; the host may
  own one for background recovery cues. Share implementation, not a universal
  workflow manager.
- Route actual `keyStateSaved` records to the interested workflow through
  composition. Define the consumer before removing a cue from a Deck; preserve
  simultaneous consumers where demonstrated. A small concrete route is enough;
  no observer interface, subscription framework, or callback scheduler.
- Completion reads accepted KEL/seal evidence. Empty queues, HTTP 204, and local
  TCP drain never substitute for that predicate.
- The invoking operation's lifetime represents active workflow work. Update
  finite-command convergence and background pending-state inspection accordingly;
  do not rebuild a global continuation registry to retain the old counters.

Keep the demonstrated finite anchor-recovery candidate pass localized to that
workflow, with an explicit comment identifying its difference from KERIpy main.
It must not become general retries/fanout in WitnessInquisitor. Preserve the
existing witness-rotation topology and its acceptance assertion. Removing this
tested recovery policy merely to copy a source loop would be a separate behavior
decision, not an incidental consequence of deleting HTTPQuery.

### Existing receivers own incoming evidence

Compose existing mailbox polling and protocol intake independently of query
sending. Retain `/replay`, `/reply`, and `/receipt` subscriptions and the topics
required by existing delegation/credential flows. Real direct endpoint ingress
and TCP receive paths remain valid; not every reply must traverse a mailbox.

Do not move provider storage into a recipient receiver or rename our
MailboxDirector to imply responsibilities it does not own. Retain awaited
message processing before cursor advancement, group/member signer selection,
provider authorization, and independent endpoint progress. An idle mailbox
must not block query transmission or another mailbox's response.

The existing genuine scoped mailbox consumer callback need not be replaced as
part of this task. Eliminate the generic query continuation callbacks; do not
add a new queue merely to eliminate an ordinary awaited subordinate call.

### HTTP ingress uses ordinary asynchronous replies

Remove both ends of the extension:

- Delete `HTTPQuery`, its runtime export, the direct CESR response intake, and
  its query-only 500 ms / five-second SSE policy.
- Remove `directQueryResponses` from host policy, host options, and CLI wiring.
  Remove `deferredDirectQueryResponse`, its 60-second wait, HTTP query
  reservations, and the earlier-query/final-query direct-response handoff logic.
- Valid ordinary non-mailbox query requests return 204 after the existing
  ingestion boundary. Their reply/replay cues follow Respondant/Poster. This
  acknowledges HTTP intake, not satisfaction of the query.
- Authorized `mbx` remains the SSE path. Preserve exact-envelope authorization;
  a valid SAID does not authenticate substituted attachments. Preserve existing
  rejection behavior and protocol query-not-found escrows.
- HTTP ingress must not drive an outgoing query worker while handling frames.
- Delete Respondant's direct-HTTP-only `openReply`/`enqueueReply` and helpers
  when their remaining production references are gone. Keep shared reply
  construction where ordinary Respondant still needs it.
- Retain narrowly required TCP correlation in `QueryReplies` and shared response
  ownership in `ReplyStreams`. Audit surviving callers before deleting members.
  Preserve OOBI/witness response bodies and receipt endpoints.

Do not weaken the ordinary messenger's finite-response/cleanup contract to
accommodate obsolete query SSE. An unsolicited response payload is not protocol
input, and cancellation still terminates an open response.

### Tufa composes commands

Move the affected query CLI implementation/presentation from keri's `app/cli`
into Tufa, following current package boundaries. Library workflows return data
or finish their operation; they do not print or accept formatting callbacks.

The command starts receive/escrow workers, runs its selected workflow under one
elapsed deadline, then halts and joins children before printing/closing stores.
Delete `controllerCatchupUrl` and the implicit OOBI retry window. An explicit
OOBI command remains available independently. Distinguish a satisfied query from
a timeout in the command result and exit status; do not print stale state as
successful convergence. Update delegation callers to await their real predicates.

## Human-review PR sequence

### PR 13e: Separate sender and concrete workflow ownership

Extract WitnessInquisitor and concrete query operations; rewire cue routing,
delegation, host lifetime, and command composition. Remove QueryCoordinator and
its generic continuation API. Move only the affected CLI code into Tufa.

Follow the ten constraints' responsibility-first rule: preserve existing wire
and failure behavior during this structural cut, including the old direct HTTP
operation privately where needed. Do not introduce compatibility aliases or new
public transitional wrappers. Keep temporary retained packets with the sender
until PR 13f removes that contract.

Validate signer/attester selection, KSN-to-logs progression, sequence/anchor
predicates, recovery cues, simultaneous query observations, and joined shutdown.
Update actual callers/declarations in this PR, not a later cleanup PR.

### PR 13f: Remove custom HTTP query behavior end to end

Delete HTTPQuery, direct server responses/options/reservations, exact-packet
retry retention, and CLI OOBI fallback. Make HTTP sending use ordinary messengers.
Preserve TCP receive composition. Remove newly dead dependencies and exports.

Review client, server, and CLI behavior together. Add the composed TypeScript
test proving 204 does not complete a query and mailbox receipt does. Convert
old direct-response tests into evidence for the new contract; retain independent
authorization, processing, cancellation, and cleanup assertions.

Run affected existing Python interop checks before merge. Do not use the next
PR as an excuse to merge a known broken KLI/Tufa path.

### PR 13g: Fill reference-peer coverage and qualify installed packages

Extend existing interop owners only where PRs 13e/13f leave a real gap. Reuse current
witness/mailbox environments and exact profile pins, not new reference shims.
Run the bounded matrix below and installed Deno/Node library/CLI checks.

Keep focused tests with their implementation PRs. This last cut supplies missing
cross-peer evidence and release qualification, not basic correctness tests.
If all required evidence lands with PR 13f, fold this cut into that PR.

## Verification gates

Preserve existing topology; do not simplify multi-witness tests to force success.
No exhaustive cross-product of every command, transport, and Python version.
Do not add tests or lint checks solely to assert deleted APIs or designs remain absent.

| Gate                             | Required evidence                                                                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Real query progression           | Fresh/stale reader sends KSN, learns newer state, requests logs, accepts target sequence/SAID through the normal receive path                                                  |
| HTTP contract                    | Tufa ordinary `logs`/`ksn` requests return 204 without CESR/SSE; `mbx` retrieves actual reply/replay messages                                                                  |
| No synchronous-response shortcut | A successful send alone leaves the workflow incomplete; an ordinary HTTP response body containing a valid event does not mutate KEL state                                      |
| Mailbox safety                   | Existing exact-signature authorization tests remain; cursor advances after processing; cancellation joins the active request before store closure                              |
| TCP                              | Existing real-socket query/receipt regression still accepts evidence and joins RX/TX; no assumption that TCP must use an HTTP mailbox                                          |
| Reference peers                  | Main, GLEIF 1.2.17, and 1.3.6 each exercise Tufa querying Python-backed state and Python KLI querying Tufa-backed state, with observed 204 and independently received evidence |
| Anchor/delegation                | Existing later-anchor/witness-rotation and delegation recovery cases retain real accepted-state assertions                                                                     |
| Failure boundary                 | One refusal/cancellation case and one command deadline with absent evidence; no success claim, hidden OOBI fallback, or resend loop                                            |
| Installed surface                | Public imports/types compile the supported contracts and an installed Tufa query uses the new composition                                                                      |

Prefer extending `interop-witness-kli-tufa.test.ts`, `interop-kli-tufa.test.ts`,
and `interop-mailbox-kli-tufa.test.ts`. Review `querying`, `query-transport`,
`query-delivery`, `query-runtime`, `query-replies`, cue/delegation/mailbox units,
`sign-query-rotate-cli`, and Tufa `progressive-ingress` tests for affected
assertions. Reuse evidence across profiles where the relevant test already runs;
record exact commits rather than claiming an unrun profile.

Use existing Docker test tooling when appropriate; do not mutate the main
thread's active test environment. Run formatting, lint/type/library-boundary,
test ownership, changeset, and package checks appropriate to each PR. The final
release qualification must be rerun after these behavioral changes.

## Documentation and completion

Make a concise breaking-change entry and release-impacting changeset. Update
only the affected ownership/API contracts in `QUERY_REPLY.md`,
`INGRESS_AND_EGRESS.md`, runtime learnings, and `MIGRATING_TO_2_0.md`.
Reconcile the superseded paragraphs in the messenger plan and link this work
from the active release plan. Do not add execution diaries.

Completion requires deletion of the old public QueryCoordinator/HTTPQuery
contracts, no production directQueryResponses path or query OOBI fallback, no
new coordinator disguised by a different name, passing composed/peer gates,
and explicit recognition that HTTP delivery and protocol acceptance differ.

Defer direct HTTP query-result extensions entirely. Retain no feature flag,
compatibility implementation, or speculative hooks for bringing them back.
Their reconsideration would require an actual use case and a separate design.
Generic retries, durable outboxes, delivery acknowledgements, broad transport
rewrites, and wholesale ProtocolProcessor removal remain outside this plan.
