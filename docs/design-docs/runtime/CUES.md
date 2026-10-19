# Cue ownership in KERIpy and keri-ts

Cues are ordinary records describing facts or follow-up work. They are neither
transport payloads nor synthetic resource handles. A Deck has a consumer; it is
not broadcast. [ADR-0013](../../adr/adr-0013-simple-component-flows.md) governs
component ownership and explicit contracts.

The [cue delivery refactor](../../plans/runtime/cue-delivery-refactor.md) records
the implementation and qualification. Poster owns every queued send and runs independently of query
delivery. Respondant eagerly constructs complete local replay sequences, and
Poster delivers ordinary signed messages FIFO with explicit retained failures.

KERIpy is the behavioral reference. Its mailbox host is supplied by the declared
fork, not current upstream. Keep these sources distinct using the
[reference inventory](../../plans/qualification/REFERENCE_ENVIRONMENTS.md).

## Production, interpretation and delivery

Processors publish cues after their owning writes commit. Interpretation constructs
protocol messages using the controller state that can honestly sign. Concrete
output workers perform network delivery outside protocol transactions.

KERIpy uses shared dict-shaped cue Decks, BaseHab.processCuesIter and host/query
doers. keri-ts preserves that model with typed records and Effection operations.
Kever returns follow-up data in its decision; Kevery applies the decision and
publishes the resulting cues. Kever does not own another output queue.

There are three cue scopes in keri-ts:

| Scope           | Producer and consumer                                                                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Habery-local    | Habery.kevery has its own Deck for local habitat processing, independently of any host                                                                                 |
| Protocol output | Runtime Kevery, Revery, Exchanger and legacy TEL/verifier processors share the protocol Deck; ProtocolProcessor captures request-correlated replies before publication |
| Application     | AgentRuntime.cues receives remaining protocol records and committed application/OOBI facts; composition routes each to its concrete owner                              |

Do not wire runtime producers to a private Deck that their consumer never sees.
Conversely, merging local and runtime scopes would make local habitat processing
depend on a host and could let background consumers steal request replies.

## Application routing

```mermaid
flowchart TD
  P[Runtime protocol producers] --> R[ProtocolProcessor reply capture]
  R --> Q[Request correlation records]
  R --> A[Application cue Deck]
  O[Committed OOBI facts] --> A
  A -->|query| C[QueryCoordinator]
  C --> H[Hab.query signing]
  H --> D[Query delivery and response intake]
  A -->|stream| M[MailboxDirector correlation and SSE]
  A -->|reply / replay / receipt / witness| S[Respondant and Hab interpretation]
  S --> T[Poster queued execution]
  S --> HTP[Independent direct response reader]
  B[Mailboxer payload storage] --> M
```

`processCuesOnce` / `cueDo` live at composition and implement that routing.
QueryCoordinator resolves the local signer and remote attester, snapshots signed
query/introduction bytes, and joins response I/O. An unavailable explicit signer
stays unresolved; no multi-Hab guessing occurs. Schema/credential recovery notices
remain notify-only rather than becoming invented logs queries.

Hab.processCuesIter yields raw wire messages for receipt, reply and replay cues.
Typed cues retain their `kin` discriminator; there is no emission wrapper or
second classification. Queries, streams and observations go directly to their
existing owners. ReplyCue remains lazy until its producing component constructs
the message, preserving current signing authority.

Respondant completely consumes each local KEL/TEL replay into source-message
records before publishing them to `runtime.postman.evts`. It prepares an entire
cue or correlated registry/credential pair before atomic `Deck.extend` publication
and source removal. There is no iterator suspended between delivery passes.
Poster resolves endpoints and constructs introductions and forwarding material
when executing the event. Mailboxer stores provider
payloads; MailboxDirector correlates stream queries and serves those payloads.
A successful `/fwd` write does not prove the query-to-SSE bridge works.

## Record and resource boundaries

Respondant and QueryCoordinator prepare and publish successfully before removing
their source record. Preparation failure leaves that source pending. Hab's low-level
processCuesIter consumes a supplied Deck head before construction; Respondant passes
a borrowed single-cue iterable so its source Deck remains intact on failure. Finite passes use their initial extent;
newly appended work waits for another pass. Notify-only or no-emission cues can
still be consumed. Do not restore CueSink hooks, preparation callbacks or generic
delivery wrappers to enforce this ordinary sequencing.

All ordinary Poster callers publish with `send({ src, dest, topic, msg, ... })`;
admission copies the signed source bytes and returns a new concrete event identity.
Callers requiring completion opt into `{ notify: true }` and use `wait(evt)` to
consume that event's `sent` or `failed` outcome from `cues`. Reusing the same signed
message creates a different admission; an older SAID success cannot satisfy it.
Only one waiter may observe an admission. Cancelling it releases the observation
without cancelling queued delivery. Pending work depends on queued/active work,
not the number of unconsumed outcome cues. Local send completion is not remote
protocol acceptance.

EXN producers construct and sign with `createExchangeMessage` outside Poster.
The standalone `sendExchangeMessage` helper accepts `dest`, starts its own worker,
waits for its concrete admission, and joins cleanup. Runtime callers use the
existing host worker. There is no alternate immediate-send Poster API.

The host runs `Poster.deliverDo` independently of query response intake. HTTP and
witness ingress publish without calling `Poster.process`; direct response readers
keep their request-owned lifetime. Focused tests may explicitly process Poster.

Poster processes events FIFO with an ordinary sequential loop over targets.
An observed refusal does not prevent remaining targets from being attempted.
A failed event leaves runnable work and enters the plain `failures` collection
with its original signed message, actual successful URLs and failure details.
Later events can proceed; there is no automatic retry. `retry(evt)` removes the
retained failure and admits a fresh event with the same source bytes. It resolves
current endpoints and rebuilds outer forwarding material, so already successful
destinations may receive duplicates. `discard(evt)` removes failed work without
sending. Failures do not contribute to pending/idle state.

Unexpected construction, storage, parser or cleanup exceptions are retained and
reported before propagating. Native network failures are classified at transport
boundaries and contained by Poster around actual send calls; arbitrary thrown
errors must not become peer refusals. Earlier refusals and successful delivery URLs
remain available if a later unexpected error propagates. HTTP requires complete successful response
bodies. Transmit-only TCP requires local drain and joined cleanup; duplex also
processes receive EOF. Closing Poster aborts and joins active I/O before
releasing queued and failed records. These records do not survive shutdown.

QueryReplies reservations are request-SAID correlation, not capacity. They capture
before ordinary cue delivery; request owners inspect and take plain records after
publishing their output. Exact current dispatch authorization still controls access.

Queues are ephemeral. OOBI worklists, protocol escrows, accepted evidence and
mailbox data/cursors retain their actual durable owners. Lazy replay readers,
HTTP bodies and sockets need cancellation and joined cleanup; ordinary cue records
do not. UI notification storage and Signaler hints are a separate observation path.

## Reference source map

| Responsibility         | KERIpy                                                               | keri-ts                                                              |
| ---------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Protocol cues          | core/eventing.py, core/routing.py, peer/exchanging.py                | core/eventing.ts, core/routing.ts, app/exchanging.ts, core/cues.ts   |
| Habitat interpretation | app/habbing.py BaseHab.processCuesIter                               | app/habbing.ts Hab.processCuesIter                                   |
| Deferred queries       | app/querying.py and app/agenting.py WitnessInquisitor                | app/querying.ts QueryCoordinator and continuations                   |
| Reply delivery         | app/storing.py Respondant, app/forwarding.py                         | app/respondant.ts, app/forwarding.ts                                 |
| Mailbox host           | fork app/mailboxing.py setupMailbox / MailboxStart                   | app/mailbox-director.ts and application host composition             |
| Query-to-SSE           | app/indirecting.py HttpEnd / QryRpyMailboxIterable / MailboxIterable | app/mailbox-director.ts, app/mailbox-sse.ts                          |
| Runtime routing        | host cueDo operations                                                | app/agent-runtime.ts, app/cue-runtime.ts, app/protocol-processing.ts |

The [flow reference](../../reference/runtime/CUE_FLOWS.md) follows concrete mailbox,
reply, query and continuation paths. [Query/reply contracts](QUERY_REPLY.md) retain
signer, attester and watcher rules. The [runtime contract](INGRESS_AND_EGRESS.md)
owns exact I/O, transaction and cleanup invariants. Actual composed qualification,
not the architecture diagram, establishes interoperability.
