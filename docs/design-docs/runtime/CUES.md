# Cue Architecture Across KERIpy And `keri-ts`

KERIpy mailbox-host comparisons use the declared fork; upstream and fork evidence
are distinct. See the [reference inventory](../../plans/qualification/REFERENCE_ENVIRONMENTS.md).

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

`docs/adr/adr-0004-cue-runtime-portability.md` remains the normative `keri-ts`
runtime contract. This document is broader: it explains the whole cross-runtime
cue graph so mailbox, query/reply, OOBI, and host work can be understood as one
system.

## Verdict

Cues are the cross-component signaling fabric of KERI runtime behavior.

They are not transport payloads.

They are typed work items emitted by processors such as `Kevery`, `Revery`,
`Oobiery`, `Kever`, or `Exchanger` when some accepted, deferred, or follow-on
action must be surfaced outside the current function.

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

**Shared runtime cue deck**

- KERIpy: Shared deck passed into hosted stacks such as witness and mailbox hosts
- `keri-ts`: `AgentRuntime.cues` created in `createAgentRuntime()`
- Why it matters: Cross-component signals must be visible to every host component that depends on them

**Habery-local cue scope**

- KERIpy: Local habitat processing can occur outside hosted doers
- `keri-ts`: `Habery.kevery` owns a separate local cue deck
- Why it matters: Local processing must not depend on a long-lived runtime existing

**Habitat-owned interpretation**

- KERIpy: `BaseHab.processCuesIter()`
- `keri-ts`: `Hab.processCuesIter()`
- Why it matters: Protocol message construction stays near the local controller state that can honestly sign it

**Host delivery**

- KERIpy: `cueDo()`-style doers route cues to responders, query handlers, or noticers
- `keri-ts`: `processCuesOnce()` / `cueDo()` deliver `CueEmission`s to a `CueSink`
- Why it matters: Host-specific transport work should not be hidden inside protocol processors

**Query correspondence**

- KERIpy: Query doers and `WitnessInquisitor` own follow-on `qry` work
- `keri-ts`: `QueryCoordinator` owns incomplete `query` cues and continuations
- Why it matters: Incomplete `query` cues are policy work, not near-wire messages

**Respondant delivery**

- KERIpy: `Respondant` / `Postman` forward non-`stream` cue results to resolved endpoints
- `keri-ts`: `Respondant` forwards non-`stream` wire emissions via `Poster`
- Why it matters: Outbound correspondence must stay separate from mailbox storage

**Mailbox query transport**

- KERIpy: `MailboxStart.cueDo()` and `HttpEnd.qrycues` bridge `stream` cues into SSE
- `keri-ts`: `MailboxDirector` retains `stream` cues and serves mailbox streams
- Why it matters: Mailbox polling depends on cue routing, not just mailbox storage

## Critical Producer And Consumer Inventory

This is the shortest useful inventory for the current critical flows. It is not
an exhaustive list of every future cue family.

**`query`**

- Typical producers in KERIpy: `routing.py`, `eventing.py`, `peer/exchanging.py`, query doers
- Typical producers in `keri-ts`: `Revery`, `Kever`, `Kevery`, `Exchanger`
- Main consumers in KERIpy: `BaseHab.processCuesIter()`, query doers, witness/mailbox host logic
- Main consumers in `keri-ts`: `QueryCoordinator`, `Hab.processCuesIter()`
- Meaning: Ask for one key-state or route-specific query

**`reply`**

- Typical producers in KERIpy: `Kevery.processQuery()` and reply-owning routes
- Typical producers in `keri-ts`: `Kevery.processQuery()` and KEL-owned reply handlers
- Main consumers in KERIpy: `BaseHab.processCuesIter()`, `Respondant`
- Main consumers in `keri-ts`: `Hab.processCuesIter()`, `Respondant`
- Meaning: Emit one signed reply message

**`replay`**

- Typical producers in KERIpy: `Kevery.processQuery("logs")`
- Typical producers in `keri-ts`: `Kevery.processQuery("logs")`
- Main consumers in KERIpy: `BaseHab.processCuesIter()`, host responders
- Main consumers in `keri-ts`: `Hab.processCuesIter()`, `Respondant`
- Meaning: Emit one replay byte stream

**`stream`**

- Typical producers in KERIpy: `Kevery.processQuery("mbx")`
- Typical producers in `keri-ts`: `Kevery.processQuery("mbx")`
- Main consumers in KERIpy: `MailboxStart.cueDo()`, `HttpEnd.qrycues`, `QryRpyMailboxIterable`
- Main consumers in `keri-ts`: `MailboxDirector`, HTTP server mailbox routes
- Meaning: Start or correlate mailbox streaming work

**`keyStateSaved`**

- Typical producers in KERIpy: `Kevery` after accepted key-state updates
- Typical producers in `keri-ts`: `Kevery` after accepted `/ksn` or key-state updates
- Main consumers in KERIpy: `KeyStateNoticer`, `LogQuerier`
- Main consumers in `keri-ts`: `QueryCoordinator` continuations
- Meaning: Notify that local key state advanced

**`receipt` / `witness`**

- Typical producers in KERIpy: event-processing acceptance paths
- Typical producers in `keri-ts`: event-processing acceptance paths
- Main consumers in KERIpy: `BaseHab.processCuesIter()`, `Respondant`
- Main consumers in `keri-ts`: `Hab.processCuesIter()`, `Respondant`
- Meaning: Emit receipt-family follow-on wire work

**`notice` / `invalid`**

- Typical producers in KERIpy: query or event-processing branches
- Typical producers in `keri-ts`: query or event-processing branches
- Main consumers in KERIpy: host loggers/responders
- Main consumers in `keri-ts`: host sinks/tests/diagnostics
- Meaning: Notify runtime of non-wire outcomes

**`oobiQueued` / `oobiResolved` / `oobiFailed`**

- Typical producers in KERIpy: OOBI subsystem
- Typical producers in `keri-ts`: `Oobiery`
- Main consumers in KERIpy: host/doer observers
- Main consumers in `keri-ts`: host sinks, runtime convergence logic
- Meaning: Surface durable OOBI lifecycle changes

## Flow reference

Detailed mailbox, respondant, query and habitat traces are in the
[cue flow reference](../../reference/runtime/CUE_FLOWS.md).

## KERIpy To `keri-ts` Correspondence

**shared runtime `cues` deck in host composition**

- `keri-ts` seam: `AgentRuntime.cues`
- Correspondence: shared runtime signaling surface

**`BaseHab.processCuesIter()`**

- `keri-ts` seam: `Hab.processCuesIter()`
- Correspondence: habitat-owned cue interpretation

**`cueDo()` doers**

- `keri-ts` seam: `processCuesOnce()` / `cueDo()`
- Correspondence: continuous host draining of interpreted cue results

**`QueryDoer`, `KeyStateNoticer`, `LogQuerier`, `SeqNoQuerier`, `AnchorQuerier`**

- `keri-ts` seam: `QueryCoordinator` continuations
- Correspondence: deferred query correspondence ownership

**`MailboxStart.cueDo()` + `HttpEnd.qrycues`**

- `keri-ts` seam: `MailboxDirector.queryCues` plus HTTP mailbox serving
- Correspondence: mailbox `stream` cue routing

**HIO doers that route cues straight to responders**

- `keri-ts` seam: typed `CueSink` implementations
- Correspondence: explicit host delivery seam

**raw byte yields from cue interpretation**

- `keri-ts` seam: structured `CueEmission`
- Correspondence: same semantics, more explicit host observability

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
- `docs/design-docs/runtime/QUERY_REPLY.md`
- `docs/adr/adr-0008-escrow-decision-architecture.md`
