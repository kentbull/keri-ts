# Cue flow reference

Companion to the [cue ownership design](../../design-docs/runtime/CUES.md).
KERIpy mailbox-host names in these traces refer to the declared mailbox fork;
verify its pin/imports separately from upstream protocol evidence.

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
5. `HttpEnd.on_post()` has already attached
   `QryRpyMailboxIterable(..., said=qry.said)` to the HTTP response.
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
