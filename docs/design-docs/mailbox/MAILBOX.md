# Mailbox architecture

A mailbox is a recipient-chosen storage provider. The sender delivers an inner
protocol message through a forwarding exchange; the recipient later polls for it.
[ADR-0009](../../adr/adr-0009-mailbox-architecture.md) owns the architecture decision.
Historical KERIpy traces are in the [flow reference](../../reference/mailbox/MAILBOX_FLOWS.md).

## Identities and storage

| Identity         | Responsibility                                          |
| ---------------- | ------------------------------------------------------- |
| Sender           | Construct and sign the inner protocol message           |
| Recipient        | Authorize provider roles and consume retrieved messages |
| Mailbox provider | Retain addressed payloads and serve authorized polling  |

Mailboxer is shared provider state above Habery: msgs holds payloads and tpcs
orders topic entries. Recipient tops holds `(recipient, provider) -> topic cursor`.
It is not provider storage. One selected mailbox identity owns its hosted routes;
POST /mailboxes updates authorization rather than creating a mailbox AID.

## Delivery

Ordinary Poster follows KERIpy `71438328`: send to every controller endpoint,
then every agent endpoint, then one random mailbox. When a composed provider store
owns an eligible local mailbox AID, publish there without requiring a URL. Only
recipients without controller, agent or mailbox roles use one random witness (or
the same local-provider shortcut). This replaces the former mailbox-first broadcast
policy. Role selection is not failover: a refusal does not choose another relay or
scheme, while later selected destinations still run. HTTPS precedes HTTP, then TCP.
Missing/unsupported selected locations remain visible failures. Producers supply
resolved AIDs; no CLI delivery preference overrides accepted endpoint state.

Mailbox SSE polling selects HTTPS, then HTTP, and polls every allowed mailbox
provider plus every current KEL witness, following KERIpy `71438328` MailboxDirector.
A TCP-only provider has no SSE target until it advertises HTTP(S); it does not
suppress HTTP-capable witnesses. Locally controlled providers remain eligible for
ordinary HTTP polling; no provider rows are scanned locally. If an AID appears in
both sets, one worker consumes its shared `(subject, provider, topic)` history.
This intentionally avoids the reference's duplicate workers for the same cursor.
Provider cursor histories remain independent of each other.

Remote delivery uses `/fwd`, with q.pre identifying the recipient and q.topic the
bucket. Legacy v1 carries e.evt plus pathed attachments. V2 binds one parent-owned
child to signed a.evt and retains its independent evidence. The provider stores
the reconstructed inner message, not the wrapper; it does not recursively accept
the child's signatures. A local provider shortcut retains the same storage semantics.

Storage requires accepted `(recipient, mailbox, addressed mailbox AID)` role state.
The request's mailbox identity must travel explicitly through runtime dispatch.
This is recipient-to-provider authorization, not a sender allowlist. The frozen
mailbox fork adds this decoupled-host gate; do not attribute fork behavior to
unmodified upstream witness hosting.

## Retrieval

The recipient sends a signed `qry` route mbx. Kevery verifies requester identity
and current signing threshold before producing a stream cue. Tufa rechecks the
exact envelope and correlates the accepted cue by query SAID, then verifies the
addressed provider authorization before SSE opens. See [read authorization](READ_AUTHORIZATION.md).

MailboxDirector owns correlation/provider reads; MailboxPoller owns remote
polling and recipient cursors. Correlations use an ordinary Deck of stream cues.
Matching removes the selected record while preserving unmatched order. Shutdown
joins active reads before clearing remaining correlations. Cue records have no
policy identity or retained-byte/item credit. SSE output reads one stored record per
HTTP demand. Input awaits each complete event's consumer; unfinished EOF/timeout
events leave cursor progress retryable. No unsolicited provider push is implied.

Cursor advancement records transport handoff, not durable application completion.
Continuous polling waits for the consumer before advancing the cursor or fetching
the next event. Finite polling returns ordinary message batches and records their
cursors. There is no consumer inbox, durable replay or acknowledgement API.
Parser completion is not an authenticated business receipt.

## Administration and discovery

POST /mailboxes takes raw CESR containing controller KEL, optional delegation
replay and a terminal signed end/role add or cut for the hosted mailbox AID.
Normal KERI processing must accept the update; accepted ends state is authority.
There is no parallel admin grant store or signature bypass.

Expose origin-rooted controller/mailbox/witness OOBIs from accepted endpoint
state. Path-prefixed mailbox OOBIs are outside this model. Discovery, authorization
update, payload storage and private retrieval are separate checks.

## Lifecycle

One runtime/listener selects hosted identities explicitly. Close response streams
before listener drain; release LMDB cursors before transport suspension. Direct
responses are tracked by the director; correlated responses own and join their
nested reader. Closing the director rejects both kinds of new response before
backing stores close. Provider responses have no byte/stream/topic/metadata policy
or synthetic release callback. Their 64 KiB output chunks control transport
granularity without restricting message size. A demanded row remains resident
while emitted; chunking does not bound whole-message residency. Keep exact cursor ordinals,
query correlation and underlying errors. Remaining listener/runtime accounting
removal and final storage/recovery qualification follow the
[storage](../../plans/db/STORAGE_RECOVERY_PLAN.md) and
[transport](../../plans/runtime/TRANSPORT_PLAN.md) plans.
