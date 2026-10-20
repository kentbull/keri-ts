# Cue flow reference

Companion to the [cue ownership design](../../design-docs/runtime/CUES.md).
KERIpy mailbox-host names refer to the declared mailbox fork; verify its pin and
imports separately from upstream protocol evidence.

## Mailbox query to SSE

In the KERIpy fork:

1. indirecting.HttpEnd receives signed query bytes into parser ingress and attaches
   QryRpyMailboxIterable for the request SAID to the response.
2. Kevery.processQuery accepts the `mbx` query and emits a stream cue.
3. mailboxing.MailboxStart.cueDo consumes the shared Deck, routing stream records
   to HttpEnd.qrycues and other records to the response path.
4. QryRpyMailboxIterable matches that SAID and creates MailboxIterable, which reads
   ordered provider payloads and emits SSE.

In keri-ts:

1. The HTTP owner submits the signed query through Reactor's buffered intake.
2. Kevery validates the query; dispatch returns the exact authorization result.
   Reactor captures correlated protocol replies before publishing ordinary cues.
3. processCuesOnce / cueDo routes stream records directly to
   MailboxDirector.retainQueryCue. No Hab interpretation or host sink is involved.
4. The HTTP response owner uses that correlation and authorization to open the
   mailbox response. MailboxDirector.streamMailbox reads ordered Mailboxer payloads
   by topic/cursor and frames SSE on demand.

The cue starts/correlates the response; Mailboxer supplies its payloads. Broken
shared wiring can leave `/fwd` storage working while mailbox queries hang. A
matching cue alone never proves authorization.

## Reply, replay and receipt delivery

KERIpy BaseHab.processCuesIter constructs protocol output; Respondant/Postman and
host doers arrange its delivery. In keri-ts:

1. Composition routes ordinary reply/replay/receipt/witness cues to Respondant.
2. Hab interpretation prepares raw protocol messages. Successful transfer precedes
   source removal; a preparation failure retains the cue.
3. Respondant fully constructs local replay sequences before atomically publishing
   Poster events and any independent direct response reader. Poster owns endpoint
   selection, FIFO delivery, retained whole-event failures and joined cleanup.
4. An authorized local forward can write Mailboxer; remote mailbox delivery stores
   at the recipient's provider and is later retrieved by polling.

MailboxDirector does not turn arbitrary non-stream cues into local mailbox writes.
Response correlation and outbound delivery have independent reader lifetimes.
Request owners publish complete reply batches before taking their correlation
records; a second TSN interpretation failure must leave the pair pending.

The [runtime contract](../../design-docs/runtime/INGRESS_AND_EGRESS.md) defines delivery completion. The host runs Poster independently of QueryCoordinator. Ingress
publishes without draining Poster. Target loops attempt remaining destinations
after refusal; failed whole events retain terminal evidence while later events
continue. The runtime contract owns the separately gated failure-reporting change.

## Missing state to outbound query

KERIpy routing/eventing can emit query cues; query doers and WitnessInquisitor
resolve follow-up work. Already-complete cues can use BaseHab.processCuesIter.
In keri-ts:

1. Revery, Kevery or Exchanger publishes a query cue describing missing state.
   Kever can return follow-up data that Kevery applies and publishes.
2. Composition sends query records to QueryCoordinator. Routed requests carry
   one target/body, an optional local signer AID, and a remote attester `src`.
   Schema/credential notices remain notify-only.
3. The coordinator resolves the explicit signer through Habery, otherwise its
   configured Hab, otherwise the sole local Hab. Missing explicit signers do not
   fall back. Unresolved requests stay pending.
4. It selects an attester/endpoint and synchronously snapshots Hab.query output
   plus that signer's introduction before removing the source request.
5. deliverOnce performs actual transport and response intake. Failure/cancellation
   retains the captured packet; retries do not sign again.

Direct component callers can still interpret already-resolved query cues through
Hab.processCuesIter. The runtime does not route unresolved cues through a generic
Hab-to-sink pipeline. Attester priority and deterministic selection are specified
in the [query contract](../../design-docs/runtime/QUERY_REPLY.md).

## OOBI and query continuation

1. Oobiery.resolve writes durable oobis work and publishes oobiQueued.
2. Its worker fetches/parses input, settles real cleanup and records a terminal
   result before publishing oobiResolved/oobiFailed. Retrieval completion is not
   universal acceptance of every incoming event.
3. Kevery publishes keyStateSaved after accepted state advances. QueryCoordinator
   observes it and ticks its continuations against committed state.
4. KeyStateNoticer may progress from KSN to logs; sequence and anchor continuations
   finish only when their accepted local condition holds. Anchor recovery asks
   each eligible attester once, or retains one unresolved ordinary request.

The host runs component workers concurrently. Finite CLI flows observe accepted
state and elapsed deadlines over those same workers, then join them before closing
stores. Durable worklists are recovery authority; cues announce work or facts.
No serial runtime pump, generic event bus or application accounting is required.
