# Messenger ownership and protocol processing

Status: implementation in progress; phases 1 and 2 are merged in PRs #532 and #533;
phase 3 introduces TCPMessenger. Later phases and final qualification remain outstanding. Planning baseline: local HEAD and remote `master` both verified at
`d735cfef1cf5e2abaf06517fcb6b55ed694e6ea4` on 2026-10-19, after PRs #528–531.
Recheck the base before implementation. Preserve the original checkout's unrelated
formatting edit. This document does not change the current runtime contract.

## Decision

Introduce concrete `TCPMessenger` and `HTTPMessenger` classes. Each receiving
messenger owns its parser lifetime and a distinct Kevery. Extract shared protocol
processing from Reactor into one concrete `ProtocolProcessor` per composed host.
Reactor remains an input owner, not a dependency of outbound messengers or Poster.

Keep shared, configured Revery, Exchanger, Tevery and Verifier owners where current
behavior requires them. Do not construct a complete independent application handler
graph per connection. In particular, shared databases alone do not serialize async
exchange admission or preserve live query correlations. This is the deliberate
qualification to the preference for messenger-local handlers.

The extraction replaces Reactor's existing processing implementation. It does not
add a Receiver facade, dispatcher interface, generic service factory, callback queue,
second delivery queue, or a universal execution gate. ProtocolProcessor exposes
protocol operations, never arbitrary application callbacks.

Apply the workspace's ten constraints by their substance: move ownership before
changing behavior, preserve cohesive protocol and transport boundaries, and delete
replaced concepts. The authoritative local source is
`/Users/kbull/enc/enctx/adrs/ten-constraints.md`.
[ADR-0013](../../adr/adr-0013-simple-component-flows.md) governs implementation.

## References and findings

Protocol reference: KERIpy `7143832813cac6a394ab1faf9be83bb3372be87c`.
Operational reference: [GLEIF-IT KERIpy v1.2.17 at
`b8626e1d58770a4a480ea72a01acc5580278a9f2`](https://github.com/GLEIF-IT/keripy/tree/b8626e1d58770a4a480ea72a01acc5580278a9f2).
Use the actual reference source and tests; neither version is a blanket design mandate.

| Evidence at the planning baseline                                                                    | Consequence                                                                                             |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `app/reactor.ts` combines byte ingress, dispatch serialization, reply capture and escrow advancement | Separate input lifetime from protocol processing; relocate the implementation rather than wrap Reactor  |
| `core/eventing.ts:Kevery.kevers` returns `db.kevers`; `prefixes` also comes from Baser               | Distinct Kevery instances can share accepted state without separate caches                              |
| `Kevery` also owns sender policy, a cue destination, Revery linkage and optional Kramer              | Every new instance must preserve these bindings; `new Kevery(db)` alone is insufficient                 |
| `Kevery.registerReplyRoutes` binds `/ksn` and watcher routes to an instance                          | Register once against the long-lived semantic owner; do not overwrite shared routes for each connection |
| `Tevery.registerReplyRoutes` owns both TSN routes through its shared Revery                          | Keep the existing Tevery/Revery relationship and registry-before-credential handling                    |
| `Exchanger.admission()` throws when another admission is active; handlers can suspend                | Preserve the shared protocol turn across async processing and joined cancellation                       |
| Reactor captures `QueryReplies` before publishing ordinary cues                                      | Keep one correlation owner shared by direct request handlers and protocol publication                   |
| `tcp-conversation.ts` already owns parser and RX/TX lifetimes                                        | Move this work into TCPMessenger and delete the replaced application wrapper                            |
| `cesr-egress.ts` already owns request/body cleanup and framing                                       | Reuse the substantive lower HTTP operations; do not reproduce fetch/stream mechanics                    |
| GLEIF `TCPMessenger` owns a Parser and Kevery; HTTPMessenger tracks complete responses               | Copy the responsibility boundaries, not HIO's scheduler implementation                                  |
| GLEIF `TCPStreamMessenger` is a one-shot local-send lifetime; HTTPStreamMessenger is one PUT         | Stream naming does not simply distinguish bytes from async iterables                                    |

Relevant TypeScript sources are under `packages/keri/src/`: `app/reactor.ts`,
`app/parsering.ts`, `app/query-replies.ts`, `app/agent-runtime.ts`,
`app/forwarding.ts`, `app/tcp-conversation.ts`, `app/tcp-egress.ts`,
`app/cesr-egress.ts`, `app/exchanging.ts`, `core/eventing.ts` and `vdr/eventing.ts`.
The Python evidence is `src/keri/app/agenting.py` and `forwarding.py` at the pins above.

## Concrete dependency model

### ProtocolProcessor: shared protocol work, no input or transport

Move the following implementation out of Reactor:

- `dispatch`, including envelope normalization, optional escrow advancement and
  mailbox authorization computed while the protocol turn remains held;
- `acquireProtocol`, its busy state and cancellation-safe waiting operations;
- `publishCues`, including reply capture before ordinary publication;
- `advanceEscrows`, `processEscrowsOnce` and the host's `escrowDo` worker.

Keep the existing `dispatchEnvelope` routing function as the subordinate protocol
router. Do not add another routing interface or duplicate its message-type switch.

Composition constructs the long-lived `kvy`, `rvy`, `exc`, optional `tvy`/`vry`,
registry, private protocol cue Deck, application cue Deck, and `QueryReplies`.
ProtocolProcessor receives these as explicit constructor dependencies. Absent
optional capabilities are explicit `null` arguments, not omitted service lookups.
The constructor validates compatible stores and cue flows where necessary.

ProtocolProcessor owns the long-lived KEL/reply route and escrow processor. Each
messenger instead uses its own Kevery for that input's KEL, receipt and query
dispatch. Both use the same Baser cache. The long-lived Kevery remains the
authoritative v2 message-policy/KRAM owner passed explicitly to dispatchEnvelope;
otherwise mutable allow/deny changes would diverge across copied receiver policies. Revery
continues routing semantic replies to the long-lived registered handlers.

Proposed operations:

```ts
makeKevery(): Kevery;
dispatch(frame: CesrFrame, options: DispatchOptions, kvy: Kevery): Operation<ProtocolDispatchResult>;
processEscrowsOnce(): Operation<void>;
escrowDo(): Operation<never>;
```

`makeKevery()` is a concrete construction operation, not a component lookup. It
creates a distinct Kevery bound to the same Baser, sender policy, private cue Deck,
Revery and optional Kramer as the configured long-lived processor. It neither
registers routes nor starts a worker. Keep this binding knowledge inside the construction operation. The concrete owner
exposes documented readonly semantic collaborators for composition and direct tests;
application entrypoints receive their actual `exc` or `replies` dependency from the
root rather than discovering handlers through Reactor.
Verify policy equivalence across long-lived and messenger-created instances;
do not introduce a new dynamic policy-update API.

`dispatch` uses the supplied Kevery directly inside the existing serialized
protocol operation. It verifies the processor belongs to the composed store/cue
domain. No temporary swapping of `this.kvy`, no processor registry and no generic
`run(callback)` gate. Cancellation before admission prevents effects; cancellation
inside admission joins handler cleanup before the next operation enters.

### Input owners and shared state

| Responsibility                                                            | Owner after the refactor                                             |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Accepted KEL/Kever state and durable escrows                              | Existing Baser/Reger/registry stores                                 |
| Per-input CESR parser iteration and cancellation                          | Reactor, TCPMessenger, HTTPMessenger or the existing request owner   |
| Input-specific KEL/receipt/query dispatch                                 | That input owner's Kevery                                            |
| KSN/watcher reply routes and background KEL escrows                       | Long-lived Kevery composed with ProtocolProcessor                    |
| Reply validation/routes, exchange routes, TEL and credential verification | Existing long-lived Revery, Exchanger, Tevery, Verifier and registry |
| Serialized protocol processing and cue publication                        | ProtocolProcessor                                                    |
| Active direct-response correlations                                       | One QueryReplies instance shared explicitly                          |
| Background escrow scheduling                                              | One ProtocolProcessor worker per host                                |
| Runnable sends, target policy, retry/discard and outcomes                 | Poster                                                               |

Do not introduce an escrow worker per messenger. A reply missing a prerequisite
must remain recoverable after the messenger closes through the existing durable
escrow stores and the long-lived processors. Short-lived parser/Kevery teardown
must not clear shared state, application cues, or correlation slots.

QueryReplies remains a separate concrete component. HTTP/TCP ingress receives it
explicitly, reserves a request slot, and closes that slot in the request lifetime.
ProtocolProcessor captures into the same object. Do not move request-slot ownership
into the messenger or conflate query SAIDs with Poster event identities.

### Reactor after extraction

Reactor retains its ingress Deck, `ingest`, `clearIngress`, parser/source lifetime,
`process`, `processBytes`, `processOnce`, `hasIngress` and `msgDo`. Its constructor
receives a concrete ProtocolProcessor and constructs its own Kevery through it. Its parser calls
`protocol.dispatch(frame, kvy, options)` directly.

Remove Reactor's public protocol proxies: `dispatch`, escrow methods, handler
properties and `replies`. Migrate their callers to the real owner. Do not retain
delegating compatibility methods. Actual byte intake can continue using Reactor;
this phase does not rename all existing OOBI, mailbox or synthetic ingress as
direct-mode networking.

Keep non-network input cleanup in a small shared parsing operation only if needed
by multiple real owners. Such a helper must own parser iteration/cleanup; it must
not become a second protocol dispatcher or a fake receiver interface.

### Messenger construction and direct calls

The following signatures show the intended structural dependencies; per-attempt
options contain only actual transport/protocol choices and cancellation signals.

```ts
new Poster(hby, mbx, protocol, services);
new Reactor(protocol);
new TCPMessenger(protocol, services.clock); // Explicit null permits transmit-only use.
new HTTPMessenger(protocol, services.http, services.clock);
```

Poster explicitly selects a concrete messenger for the already-selected endpoint.
No injected factory, transport registry, superclass or Messenger interface is
needed for these two known protocols. Each messenger constructs and owns its
distinct `kvy` using `makeKevery()`. It owns a fresh parser iterator for each
received source. Shared processor construction binds policy; it does not own the
messenger's socket or lifetime.

```text
Poster: FIFO event → endpoint + prepared wire → TCPMessenger or HTTPMessenger
TCPMessenger: socket RX → its parser → protocol.dispatch(frame, its kvy, options)
HTTPMessenger: CESR response → its parser → protocol.dispatch(frame, its kvy, options)
Reactor: ingress source → its parser → protocol.dispatch(frame, its kvy, options)
ProtocolProcessor → existing dispatchEnvelope → actual protocol handlers
```

Previously the TCP application operation called `Reactor.dispatch`; it now calls
`ProtocolProcessor.dispatch`. The messenger replaces the TCP application operation.
Neither path passes through Reactor, a receiver adapter, or a new dispatch facade.
ProtocolProcessor contains the moved implementation and state, not a call back to
Reactor. Poster never manipulates parser or protocol-turn state.

One attempt runs in its caller's Effection scope and returns a concrete transport
result or throws with the existing classification. No nested `msgs` queue, polling
of child `idle`, completion history, or messenger-level retry. Poster converts
attempt results into its existing event-level outcomes and preserves partial success.
The runtime starts Poster independently, as today; it does not start persistent
messenger workers in addition to each active attempt.

TCPMessenger owns concurrent TX/RX and parser cleanup when replies are requested;
transmit-only attempts retain local-drain completion. HTTPMessenger owns ordinary
complete-response delivery and the existing finite query-response consumption,
including the current bounded SSE query case. Ordinary Poster HTTP sends continue
draining responses without newly interpreting arbitrary response bytes as CESR.
MailboxDirector's long-lived SSE polling remains a separate request owner.
Receipt GET/OOBI input need not be forced into an outbound POST abstraction: their
existing owners can use owned parser operations and ProtocolProcessor directly.

Retain substantive `tcp-egress`, `socket-source`, `cesr-egress` and HTTP framing
helpers at their present low-level boundaries. They know sockets, byte sources,
HTTP services and cancellation, not Habery or application protocol dispatch.
Replace `tcp-conversation` and application-level prepared-target dispatch wrappers
once all callers migrate. Preserve useful public byte-send operations where they
serve independent transport callers; they must not be a parallel Poster execution path.

No `TCPStreamMessenger` or `HTTPStreamMessenger` in this plan. Finite bytes adapt
to the same existing pull-source implementation. Keep local-transmit versus duplex
completion explicit. Do not add HTTP PUT or a new lifetime merely to match a name.

### Constructors and lifecycle naming

Remove PosterOptions. Make its dependencies required positional arguments; use
`mbx: Mailboxer | null` to express real provider absence. Keep RuntimeServices as
the existing required clock/HTTP dependency, not a component-discovery bundle.
Default services are selected at composition or standalone entrypoints.

Rename `assertOpen` to `ensureOpen` with no alias. Keep admission and waiter checks.
Remove redundant producer preflights for already-built records. Retain a preflight
before construction or opening a response stream where the operation otherwise
creates work that a closed postman cannot accept. Audit `openReply` separately:
the direct stream and queued events must still publish atomically from the caller's
perspective, and HTTP-only replies without outbound routing must remain supported.

Use `mbx`, `kvy`, `rvy`, `exc`, `tvy`, `vry`, `src`, `dest`, `msg`, `msgs`, `evts`,
`cues` and `postman` where those meanings apply. Do not rename protocol fields or
collapse signer versus remote query `src`. Limit naming edits to touched ownership
and composition boundaries; avoid a repository-wide abbreviation sweep.

## Phased implementation and review cuts

Each implementation phase is a separate cohesive PR, built on the preceding merged
phase. Keep intermediate trees runnable. Implementation is authorized as sequential commits and PRs, merged as ready.
Run scoped checks on each PR and the full suite only after the last PR merges.

### Maintainer documentation required in every phase

Documentation is part of each code change, not a deferred final cleanup. For every
class touched by a phase, review and supply maintainer-grade doc comments for the
class, constructor, every public and private function, and every member attribute,
including private fields and constructor parameter properties. Document touched
standalone functions and public record/type members with the same care.

- Class comments explain the mental model, responsibility, lifetime, owned versus
  borrowed dependencies, and important invariants. Describe KERIpy correspondence
  and intentional TypeScript differences where they help a maintainer.
- Function comments explain purpose, meaningful inputs/results, effects and ordering.
  Explain failure and cancellation behavior where relevant, including who joins
  cleanup and what completion does or does not establish. Match detail to complexity.
- Member comments explain what the value represents, who owns or changes it, and
  why it exists. Queues, flags, shared processors and correlation state need clear
  lifetime/consumer rules. Expand abbreviations such as `kvy` and `mbx` at their
  declarations so KERIpy familiarity is helpful rather than required.
- Inline comments make each touched function's flow readable: explain meaningful
  stages, source consumption/publication order, protocol-turn boundaries, directional
  transport completion, error classification and cleanup order where applicable.
  A short function may need only its doc comment; do not narrate assignments or add
  mechanically repetitive comments that obscure the code.
- Update or delete comments when moving behavior so they describe the actual owner
  and current contract. Do not leave references to removed cursors, receiver facades
  or obsolete completion semantics. Prefer plain language and concrete examples
  where a subtle contract would otherwise take several readings to understand.

Each phase's exit includes a human readability review of these comments alongside
the implementation. Add no documentation tests, new lint rules, comment-coverage
checker, or automated documentation gate. Existing repository checks remain as-is.

### Phase 0 — record the plan and baseline

- Save this plan and route it from the docs indexes.
- Verify the two reference pins, current master, affected callers and test owners.
- Record the narrow deviation from per-messenger full handler graphs above.
- Preserve the original checkout and do not repurpose its dirty work.

Exit: source-grounded ownership/dependency map and phase gates are reviewable.

### Phase 1 — explicit Poster dependencies and lifecycle names

- Replace PosterOptions with explicit required parameters, temporarily retaining
  the actual Reactor dependency until phase 2 moves that responsibility.
- Migrate all standalone and composed constructors, including tests; no defaults
  inside Poster that conceal dependencies. Preserve transmit-only standalone use
  with an explicitly absent receive capability during this structural cut.
- Rename its Mailboxer field/parameter to `mbx`; rename `assertOpen` to `ensureOpen`
  and remove redundant preflights without changing source-consumption ordering.
- Preserve queue, completion, retry, transport and direct-response behavior.

Exit: affected constructors compile; closed admission/waiters and pre-production
guards pass; forwarding, cue/runtime and standalone CLI behavior remains unchanged.

### Phase 2 — extract the actual protocol owner

- Add ProtocolProcessor with the moved turn, dispatch, publication and escrow
  implementation. Construct dependencies explicitly in composition.
- Move QueryReplies construction to composition and inject the same instance into
  ProtocolProcessor and request owners. Register all existing routes once.
- Give Reactor its own Kevery and parser; migrate frame-dispatch and escrow callers
  directly to ProtocolProcessor. Remove proxy APIs and handler discovery through Reactor.
- Wire host escrow work to ProtocolProcessor. Keep `makeKevery` policy bindings and
  dispatch's explicit Kevery argument ready for actual input owners in this phase.
- Remove Reactor from Poster and the TCP conversation's dependency contract; the
  existing conversation owns its parser/Kevery and calls ProtocolProcessor directly.
  This is the implementation moved into TCPMessenger next, not another supported facade.
- Standalone entrypoints compose only the protocol processors they require over
  their existing Habery; do not open a second AgentRuntime or duplicate stores.

Exit: direct HTTP/TCP authorization, TSN pairing, input cancellation, query capture,
escrows, OOBI routes and exchange admission preserve behavior through the new owner.
No dispatch method forwards back to Reactor. Source/type callers are fully migrated.

### Phase 3 — TCPMessenger owns each TCP attempt

- Move TCP conversation execution into concrete TCPMessenger. Retain one parser
  and Kevery per messenger, the shared policy bindings, and lower socket helpers.
- Migrate Poster, QueryCoordinator and witness send paths. Each remains its current
  workflow owner; QueryCoordinator does not start using Poster's queue.
- Preserve transmit-only versus duplex choices, current receive completion and
  absolute deadlines, half-close behavior, abort/join ordering and error identity.
- Delete the replaced conversation APIs/types and application forwarding wrappers
  after their actual callers migrate. Update explicit package exports.
- Keep retained failure and retry only in Poster or the existing query owner.

Exit: distinct messenger Keverys see shared accepted state; same-socket receipts
persist; simultaneous direct ingress and messenger replies do not overlap unsafe
exchange admissions; failed/cancelled attempts join children before stores close.

### Phase 4 — HTTPMessenger owns POST/query attempt lifetimes

- Consolidate Poster HTTP sending and finite query response intake into the concrete
  HTTPMessenger using the existing framing/fetch/body owners.
- Preserve plain full-body drain for ordinary sends and explicit parser ownership
  for CESR/query responses. Preserve the bounded SSE query path and authentication.
- Migrate applicable witness send paths without absorbing receipt GET acceptance,
  long-lived mailbox polling, or OOBI request semantics into a generic HTTP owner.
- Remove replaced application wrappers; keep substantive lower HTTP framing and
  resource code. No mirrored TCP inheritance or stream subclass.

Exit: refusal, truncation, media negotiation, cancellation and cleanup classifications
are unchanged; query replies and bounded SSE intake use owned parser/Kevery instances;
headers alone never satisfy delivery. Sender, receiver and application acceptance
remain separate claims.

### Phase 5 — composed qualification and final contract review

- Run maintained integrations and full qualification on the composed result.
- Recheck concurrency, delayed prerequisite escrow recovery, teardown and no API
  proxies/unused messenger queues. Remove leftover scaffolding in its owning PR.
- Update ADR-0003/0004/0013, runtime ingress/egress and cue/query contracts, architecture
  routing and runtime learnings to describe implementation, not proposed behavior.
- Record current evidence separately from published 1.0.0 qualification.

This is a final validation checkpoint; create a separate PR only if it contains
cohesive qualification fixes or documentation not already completed in earlier cuts.
Do not leave the tests that establish each phase's exit until this checkpoint.

## Caller migration and validation inventory

| Area                                        | Principal callers and test owners                                                                                                                     |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Composition, dispatch/escrows, cancellation | `agent-runtime.ts`, `reactor.ts`; `reactor.test.ts`, `reactor-turn.test.ts`, `runtime-store-ownership.test.ts`                                        |
| Poster, cues, completion, standalone sends  | `forwarding.ts`, `respondant.ts`, `exchange-messaging.ts`, CLI constructors; `forwarding.test.ts`, `cue-runtime.test.ts`, `runtime-responder.test.ts` |
| Queries and witness replies                 | `querying.ts`, `witnessing.ts`, delegation callers; `query-transport.test.ts`, `witness-transport.test.ts` and existing query/receipt tests           |
| Direct server correlations/authorization    | Tufa `host/witness-tcp.ts`, `http/protocol/endpoints/generic-cesr-ingress.ts` and mailbox endpoints; maintained Tufa HTTP/server suites               |
| OOBI/mailbox/DID inputs                     | `oobiery.ts`, runtime mailbox intake, `did/webs/resolving.ts`, `verifier-agent.ts`; schema/OOBI, mailbox and verifier tests                           |
| Application processor access                | IPEX/multisig/credential workflows and CLI helpers currently reading `reactor.exchanger` or invoking escrow methods                                   |
| Public/package boundary                     | `src/runtime/index.ts`, runtime entrypoints, installed npm/type smoke checks                                                                          |

Keep existing test topology. Move tests to actual owners without replacing protocol
assertions with constructor-shape checks. Register new files with the maintained
suite inventory (`scripts/ci/keri-test-suites.ts`) and run `deno task test:audit`.

Required regressions:

1. Two messenger Keverys are distinct but share Baser's live Kever cache. A rotation
   accepted through one input is visible to another input and to long-lived escrows.
2. Missing signer/receipt prerequisites persist beyond connection close and resolve
   through the one host escrow worker. Closing a messenger loses no pending evidence.
3. Sender policy and KRAM behavior match direct ingress; no weaker messenger admission.
4. Messenger/direct HTTP/direct TCP processing serialize around a suspended EXN
   handler; cancellation removes waiters and joins the active handler before release.
5. A pending correlated query captures output produced by another input/escrow pass;
   duplicate requests and TSN pairs remain correctly ordered and independently owned.
6. Route registration remains bound to long-lived KSN/watcher/TSN/OOBI handlers,
   not whichever messenger was created last.
7. TCP local drain survives late receive reset for transmit-only sending; duplex
   preserves required replies, directional EOF, timeout and cleanup behavior.
8. HTTP non-2xx, truncated bodies, parser/storage errors and foreign cleanup failures
   keep their existing distinct outcomes; no redirect/reconnect/replay is added.
9. Poster retains whole-event failures, attempts remaining targets after refusal,
   advances later events, and requires explicit retry. Partial deliveries and exact
   event-identity outcomes remain intact; completion consumption never changes idle.
10. Closed Poster rejects admission and wakes waiters. Removed redundant checks do
    not consume a cue/pair or allocate a direct response after rejection.
11. HTTP-only correlated replies, direct TCP response lifetimes and independent queued
    publication remain supported. No ingress handler starts draining Poster's queue.
12. Finite CLI commands start their workers, observe actual outcomes and join all
    network/parser work before owned stores close.

Use focused unit owners first, then applicable maintained groups: `runtime-medium`,
`runtime-slow`, `interop-witness`, `interop-mailbox`, `interop-delegation`, relevant
IPEX/ACDC groups, OOBI bootstrap and Tufa quality/server tests. Run root formatting,
lint, quality/type checks, test ownership audit, changeset checks and installed
package smoke/type checks for the affected packages. Final qualification includes
`deno task test:quality:keri:full`, `deno task test:quality:tufa`, CESR and CI/package
tool tests, plus `npm:build:all` and the maintained installed-package smoke scripts.

Scoped PR CI follows `docs/reference/PR_TEST_SCOPE.md` with exact-head local evidence;
it does not convert unrun integrations into passing checks. Constructor/export/type
removal is release-impacting: use real package changesets, not readability-only
empty entries. Each phase updates the owning contracts and runs the prescribed
ENCTX index maintenance after final edits/Git mutations, requiring healthy results.

## Explicit limits and rejection criteria

Keep the [cue reliability roadmap](cue-reliability-roadmap.md) unchanged in scope:
no automatic retry, exact final-wire retention, per-target retry cursors, fairness,
concurrency scheduling, durable intent or remote-acceptance protocol is added.
Do not change TCP completion policy while moving its ownership. Any later move
from duplex receive completion to local-send completion needs its own caller-specific
proposal and evidence.

Reject an implementation that merely renames Reactor as ProtocolProcessor, leaves
all ingress/network responsibilities inside it, wraps it in a Receiver adapter,
clones application handler graphs per connection, registers temporary reply owners,
or leaves redundant wrapper APIs indefinitely. The acceptable extraction removes
input and transport knowledge from shared processing and gives messengers actual
parser/attempt ownership with direct calls to the real protocol implementation.
