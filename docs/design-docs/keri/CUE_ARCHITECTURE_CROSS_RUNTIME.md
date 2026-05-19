# Cue Architecture Across KERIpy And `keri-ts`

Date: 2026-04-07

## Purpose

Capture the maintainer mental model for cues across both runtimes.

This document is the primary end-to-end explainer for:

- what a cue is
- who produces cues
- who consumes cues
- how cue decks are wired through hosts
- how KERIpy and `keri-ts` correspond structurally
- how mailbox/query streaming depends on cue routing

KERIpy remains the behavioral reference implementation. `keri-ts` documents the
same architecture with more explicit runtime ownership and typed host seams.

`docs/adr/adr-0004-cue-runtime-portability.md` remains the normative
`keri-ts` runtime contract. This document is broader: it explains the whole
cross-runtime cue graph so mailbox, query/reply, OOBI, and host work can be
understood as one system.

## Verdict

Cues are the cross-component signaling fabric of KERI runtime behavior.

They are not transport payloads.

They are typed work items emitted by processors such as `Kevery`, `Revery`,
`Oobiery`, `Kever`, or `Exchanger` when some accepted, deferred, or
follow-on action must be surfaced outside the current function.

The architecture only makes sense when it is split into three stages:

1. Production
   - processors emit typed cues onto a shared deck or local queue
2. Interpretation
   - habitat-owned logic turns some cues into signed wire bytes and leaves other
     cues as transport or notify signals
3. Delivery
   - host/runtime components drain the interpreted result and decide whether to
     send bytes, notify continuations, persist mailbox traffic, or start a
     transport-specific flow such as SSE

Two false mental models cause repeated bugs:

- a cue deck is not "just a transport queue"
- mailbox storage and mailbox query response are not the same path
- mailbox storage is not the respondant path

## Shared Terms

| Term                   | Meaning                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| cue                    | Typed cross-component signal such as `query`, `reply`, `replay`, `stream`, or `keyStateSaved`                 |
| cue deck               | Shared in-memory queue used to hand off cues between processors and host/runtime logic                        |
| interpretation         | Habitat-owned step that turns semantic cues into wire bytes when honest source/destination information exists |
| delivery               | Host/runtime step that consumes interpreted results and applies transport-specific side effects               |
| incomplete `query` cue | A correspondence request that still needs runtime policy such as habitat or endpoint resolution               |
| complete `query` cue   | A wire-ready query cue that already has enough information for habitat-owned message construction             |
| `stream` cue           | A transport request that starts mailbox/query streaming; it is not the mailbox payload itself                 |

## Core Architecture

### KERIpy Shape

The KERIpy mental model is:

- processors such as `Kevery`, `Revery`, and other subsystems push dict-shaped
  cues onto a shared deck
- `BaseHab.processCuesIter()` is the habitat-owned interpretation seam
- doers such as `cueDo()`, `MailboxStart.cueDo()`, or query doers drain shared
  cue state and hand it to the right host surface
- local habitat work also exists outside those long-lived host doers, so not
  every cue is "owned by the server"

Important code seams:

- `keripy/src/keri/core/eventing.py`
- `keripy/src/keri/app/habbing.py`
- `keripy/src/keri/app/indirecting.py`
- `keripy/src/keri/app/querying.py`

### `keri-ts` Shape

The `keri-ts` mental model keeps the same architecture, but makes ownership
explicit:

- `createAgentRuntime()` creates one shared `Deck<AgentCue>` for runtime-hosted
  cue production
- `Reactor`, runtime `Kevery`, `Revery`, `Oobiery`, and `Exchanger` push typed
  `AgentCue` values
- `Hab.processCuesIter()` is the habitat-owned interpretation seam
- `processCuesOnce()` and `cueDo()` drain interpreted `CueEmission` values into
  a host-facing `CueSink`
- `QueryCoordinator` owns incomplete `query` cue correspondence
- `Respondant` owns non-`stream` cue delivery such as `reply`, `replay`,
  `receipt`, and `witness`
- `MailboxDirector` owns mailbox-specific storage and `stream` cue correlation
- `Habery.kevery` still has its own local cue deck for local habitat processing
  outside a long-lived runtime host

Important code seams:

- `packages/keri/src/core/cues.ts`
- `packages/keri/src/app/agent-runtime.ts`
- `packages/keri/src/app/cue-runtime.ts`
- `packages/keri/src/app/habbing.ts`
- `packages/keri/src/app/querying.ts`
- `packages/keri/src/app/respondant.ts`
- `packages/keri/src/app/mailbox-director.ts`

## Scope And Ownership

| Concern                      | KERIpy                                                                          | `keri-ts`                                                             | Why it matters                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Shared runtime cue deck      | Shared deck passed into hosted stacks such as witness and mailbox hosts         | `AgentRuntime.cues` created in `createAgentRuntime()`                 | Cross-component signals must be visible to every host component that depends on them          |
| Habery-local cue scope       | Local habitat processing can occur outside hosted doers                         | `Habery.kevery` owns a separate local cue deck                        | Local processing must not depend on a long-lived runtime existing                             |
| Habitat-owned interpretation | `BaseHab.processCuesIter()`                                                     | `Hab.processCuesIter()`                                               | Protocol message construction stays near the local controller state that can honestly sign it |
| Host delivery                | `cueDo()`-style doers route cues to responders, query handlers, or noticers     | `processCuesOnce()` / `cueDo()` deliver `CueEmission`s to a `CueSink` | Host-specific transport work should not be hidden inside protocol processors                  |
| Query correspondence         | Query doers and `WitnessInquisitor` own follow-on `qry` work                    | `QueryCoordinator` owns incomplete `query` cues and continuations     | Incomplete `query` cues are policy work, not near-wire messages                               |
| Respondant delivery          | `Respondant` / `Postman` forward non-`stream` cue results to resolved endpoints | `Respondant` forwards non-`stream` wire emissions via `Poster`        | Outbound correspondence must stay separate from mailbox storage                               |
| Mailbox query transport      | `MailboxStart.cueDo()` and `HttpEnd.qrycues` bridge `stream` cues into SSE      | `MailboxDirector` retains `stream` cues and serves mailbox streams    | Mailbox polling depends on cue routing, not just mailbox storage                              |

## Critical Producer And Consumer Inventory

This is the shortest useful inventory for the current critical flows. It is not
an exhaustive list of every future cue family.

| Cue kind                                     | Typical producers in KERIpy                                    | Typical producers in `keri-ts`                       | Main consumers in KERIpy                                             | Main consumers in `keri-ts`                   | Meaning                                       |
| -------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------- |
| `query`                                      | `routing.py`, `eventing.py`, `peer/exchanging.py`, query doers | `Revery`, `Kever`, `Kevery`, `Exchanger`             | `BaseHab.processCuesIter()`, query doers, witness/mailbox host logic | `QueryCoordinator`, `Hab.processCuesIter()`   | Ask for one key-state or route-specific query |
| `reply`                                      | `Kevery.processQuery()` and reply-owning routes                | `Kevery.processQuery()` and KEL-owned reply handlers | `BaseHab.processCuesIter()`, `Respondant`                            | `Hab.processCuesIter()`, `Respondant`         | Emit one signed reply message                 |
| `replay`                                     | `Kevery.processQuery("logs")`                                  | `Kevery.processQuery("logs")`                        | `BaseHab.processCuesIter()`, host responders                         | `Hab.processCuesIter()`, `Respondant`         | Emit one replay byte stream                   |
| `stream`                                     | `Kevery.processQuery("mbx")`                                   | `Kevery.processQuery("mbx")`                         | `MailboxStart.cueDo()`, `HttpEnd.qrycues`, `QryRpyMailboxIterable`   | `MailboxDirector`, HTTP server mailbox routes | Start or correlate mailbox streaming work     |
| `keyStateSaved`                              | `Kevery` after accepted key-state updates                      | `Kevery` after accepted `/ksn` or key-state updates  | `KeyStateNoticer`, `LogQuerier`                                      | `QueryCoordinator` continuations              | Notify that local key state advanced          |
| `receipt` / `witness`                        | event-processing acceptance paths                              | event-processing acceptance paths                    | `BaseHab.processCuesIter()`, `Respondant`                            | `Hab.processCuesIter()`, `Respondant`         | Emit receipt-family follow-on wire work       |
| `notice` / `invalid`                         | query or event-processing branches                             | query or event-processing branches                   | host loggers/responders                                              | host sinks/tests/diagnostics                  | Notify runtime of non-wire outcomes           |
| `oobiQueued` / `oobiResolved` / `oobiFailed` | OOBI subsystem                                                 | `Oobiery`                                            | host/doer observers                                                  | host sinks, runtime convergence logic         | Surface durable OOBI lifecycle changes        |

## End-To-End Flow Traces

### 1. Mailbox `qry -> stream cue -> SSE mailbox response`

This is the flow that broke when `MailboxStart(...)` was not given the shared
cue deck.

#### KERIpy

1. `HttpEnd.on_post()` receives a `qry` request and appends the CESR bytes to
   parser ingress.
2. `Kevery.processQuery()` validates the `mbx` query and pushes
   `dict(kin="stream", serder=..., pre=..., src=..., topics=...)`.
3. `MailboxStart.cueDo()` drains the shared `cues` deck.
4. `MailboxStart.cueDo()` routes `stream` cues to `HttpEnd.qrycues` and sends
   all other cues to the normal response path.
5. `HttpEnd.on_post()` has already attached `QryRpyMailboxIterable(..., said=qry.said)` to the HTTP response.
6. `QryRpyMailboxIterable` waits for the matching `stream` cue, then creates a
   `MailboxIterable`.
7. `MailboxIterable` reads ordered payloads from `Mailboxer` and emits SSE
   bytes.

Maintainer conclusion:

- the cue starts the transport response
- `Mailboxer` provides the payload bytes
- if shared cue wiring is broken, mailbox storage can still succeed while `mbx`
  queries hang
- `Mailboxer` is not the general cue responder; it only serves the mailbox
  payload side once a `stream` cue has been routed there

#### `keri-ts`

1. The server receives a `qry` request and routes it through the shared parser
   and runtime.
2. `Kevery.processQuery()` accepts `mbx` and pushes a typed `StreamCue`.
3. `Hab.processCuesIter()` preserves that cue as a `transport` emission instead
   of flattening it into ordinary wire bytes.
4. `processCuesOnce()` or `cueDo()` hands the emission to the active host sink.
5. `MailboxDirector` retains the `stream` cue for correlation and serves the
   mailbox stream from `Mailboxer`.
6. `MailboxDirector.streamMailbox()` reads ordered mailbox payloads by
   topic/cursor and frames them as SSE.

Maintainer conclusion:

- `stream` is still a transport request, not the payload
- mailbox storage and mailbox query response remain separate even though they
  cooperate through one runtime

### 1.5. Non-`stream` cue delivery is respondant work, not mailbox work

This is the architectural lesson that caused the delegation/query interop bug.

#### KERIpy

1. `Kevery.processQuery("logs")` or reply-owning routes emit `replay` / `reply`
   cues.
2. `BaseHab.processCuesIter()` materializes those cues into CESR byte streams.
3. `Respondant` / `Postman` forward those byte streams to the recipient's
   resolved endpoints.
4. If the recipient uses mailbox endpoints, the forwarded payload is then stored
   and later discovered through mailbox polling.

Maintainer conclusion:

- `Mailboxer` stores forwarded payloads
- `Respondant` decides that the payload should be delivered at all
- confusing those two roles collapses storage into delivery and breaks
  requester-side expectations

#### `keri-ts`

1. `Hab.processCuesIter()` interprets `reply`, `replay`, `receipt`, and
   `witness` cues into `wire` emissions.
2. `Respondant` forwards those `wire` emissions via `Poster`.
3. `MailboxDirector` only participates when the resolved destination is a
   mailbox flow or when a `stream` cue starts mailbox query transport.

Maintainer conclusion:

- if behavior smells like KERIpy `Respondant`, it belongs in
  `packages/keri/src/app/respondant.ts`
- `MailboxDirector` must not treat generic non-`stream` cues as implicit local
  mailbox writes

### 2. Missing signer state or blocked reply verification -> `query` cue -> correspondence -> outbound `qry`

#### KERIpy

1. Reply verification or other runtime work discovers that signer or key-state
   context is missing.
2. A subsystem emits a `query` cue.
3. Query doers such as `KeyStateNoticer`, `LogQuerier`, `SeqNoQuerier`, or
   `AnchorQuerier` observe local state and decide when/how to send a follow-on
   query through `WitnessInquisitor`.
4. Complete query cues can be materialized by `BaseHab.processCuesIter()`.

#### `keri-ts`

1. `Revery`, `Kever`, `Kevery`, or `Exchanger` emits an incomplete `query` cue.
2. `Hab.processCuesIter()` will only materialize the cue directly if it already
   knows both `pre` and `src`.
3. Otherwise the cue remains non-wire and is handed to `QueryCoordinator`.
4. `QueryCoordinator` resolves:
   - which habitat may honestly sign
   - which endpoint role should answer
   - whether watcher or witness overrides apply
5. Once runtime has enough information, `QueryCoordinator` emits a wire-ready
   query through `hab.query(...)`.

Maintainer conclusion:

- incomplete `query` cues are correspondence requests
- complete `query` cues are habitat-owned message-construction work

### 3. Habitat-owned cue interpretation -> signed wire bytes

This is the architectural seam that prevents host code from reimplementing
protocol message construction.

#### KERIpy

- `BaseHab.processCuesIter()` interprets semantic cues such as `receipt`,
  `reply`, `replay`, and complete `query` into message streams

#### `keri-ts`

- `Hab.processCuesIter()` turns semantic `AgentCue` values into structured
  `CueEmission` values
- `CueEmission.kind == "wire"` carries actual message bytes
- `CueEmission.kind == "notify"` keeps observer/runtime signals visible
- `CueEmission.kind == "transport"` keeps transport-specific work such as
  `stream` explicit

Maintainer conclusion:

- habitat-owned interpretation is where signed protocol messages should be built
- host/runtime code should consume interpreted results, not synthesize protocol
  bytes from scratch

### 4. OOBI and key-state continuation cues

Not every cue exists to produce immediate transport.

#### `keri-ts`

1. `Oobiery.resolve(...)` writes durable queue state into `oobis.` and emits
   `oobiQueued`.
2. `Oobiery.processOnce()` fetches/parses work and emits `oobiResolved` or
   `oobiFailed`.
3. `Kevery` emits `keyStateSaved` after accepted key-state updates.
4. `QueryCoordinator` continuations observe `keyStateSaved` and may escalate
   `ksn` work into `logs` queries or mark a continuation complete.

The equivalent KERIpy behavior is spread across OOBI/query doers and other host
observers, but the architectural rule is the same:

- durable worklists such as `oobis.` or mailbox cursors are not cues
- cues announce that state changed and some other component may now act

## KERIpy To `keri-ts` Correspondence

| KERIpy seam                                                                   | `keri-ts` seam                                        | Correspondence                                      |
| ----------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------- |
| shared runtime `cues` deck in host composition                                | `AgentRuntime.cues`                                   | shared runtime signaling surface                    |
| `BaseHab.processCuesIter()`                                                   | `Hab.processCuesIter()`                               | habitat-owned cue interpretation                    |
| `cueDo()` doers                                                               | `processCuesOnce()` / `cueDo()`                       | continuous host draining of interpreted cue results |
| `QueryDoer`, `KeyStateNoticer`, `LogQuerier`, `SeqNoQuerier`, `AnchorQuerier` | `QueryCoordinator` continuations                      | deferred query correspondence ownership             |
| `MailboxStart.cueDo()` + `HttpEnd.qrycues`                                    | `MailboxDirector.queryCues` plus HTTP mailbox serving | mailbox `stream` cue routing                        |
| HIO doers that route cues straight to responders                              | typed `CueSink` implementations                       | explicit host delivery seam                         |
| raw byte yields from cue interpretation                                       | structured `CueEmission`                              | same semantics, more explicit host observability    |

## Maintainer Invariants And Failure Modes

1. Shared cue wiring is a correctness boundary.
   - If one host component watches a private empty deck instead of the shared
     runtime deck, behavior can fail silently even when storage and parsing
     still work.

2. Mailbox storage and mailbox query response are distinct paths.
   - `/fwd` can store payloads in `Mailboxer`.
   - `mbx` response still depends on the `stream` cue bridge.

3. `stream` is not mailbox payload.
   - It is the transport signal that starts or correlates SSE mailbox
     publication.
   - The payload bytes still come from mailbox storage.

4. Incomplete `query` cues are not near-wire messages.
   - If runtime still needs habitat or attester resolution, the cue belongs to
     correspondence logic, not habitat message construction.

5. Habitat-owned interpretation should remain the protocol-message seam.
   - Do not reimplement receipt, reply, replay, or query message construction in
     generic host code.

6. Durable worklists and cues solve different problems.
   - `oobis.`, `tops.`, mailbox stores, and escrows are durable state.
   - cues are ephemeral state-change signals between components.

7. Preserving cue semantics improves debugging.
   - KERIpy often collapses cue handling to raw bytes by the time hosts see it.
   - `keri-ts` keeps `CueEmission { cue, msgs, kind }` so tests and hosts can
     inspect the original meaning directly.

## Code Map For Verification

When updating this architecture, verify claims against these code paths first.

### KERIpy

- `keripy/src/keri/core/eventing.py`
  - `Kevery.processQuery(...)`
- `keripy/src/keri/app/habbing.py`
  - `BaseHab.processCuesIter(...)`
- `keripy/src/keri/app/indirecting.py`
  - `setupMailbox(...)`
  - `MailboxStart.cueDo(...)`
  - `HttpEnd`
  - `QryRpyMailboxIterable`
  - `MailboxIterable`
- `keripy/src/keri/app/querying.py`
  - `KeyStateNoticer`
  - `LogQuerier`
  - `SeqNoQuerier`
  - `AnchorQuerier`

### `keri-ts`

- `packages/keri/src/core/cues.ts`
- `packages/keri/src/app/agent-runtime.ts`
- `packages/keri/src/app/cue-runtime.ts`
- `packages/keri/src/app/habbing.ts`
- `packages/keri/src/core/eventing.ts`
- `packages/keri/src/app/querying.ts`
- `packages/keri/src/app/mailbox-director.ts`
- `packages/keri/src/app/oobiery.ts`

## Related Docs

- `docs/adr/adr-0004-cue-runtime-portability.md`
- `docs/adr/adr-0009-mailbox-architecture.md`
- `docs/design-docs/keri/QUERY_REPLY_CORRESPONDENCE_AND_WATCHER_SUPPORT.md`
- `docs/adr/adr-0008-escrow-decision-architecture.md`
