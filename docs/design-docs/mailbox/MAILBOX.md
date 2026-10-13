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

Tufa's sender policy prefers accepted mailbox endpoints, sends to all selected
mailboxes and otherwise falls back to direct controller/agent delivery. Enabled
Outboxer state retains failed sends for retry. This operational selection is
distinct from the inner message's validity.

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
polling and recipient cursors. SSE output reads one admitted stored record per
HTTP demand. Input awaits each complete event's consumer; unfinished EOF/timeout
events leave cursor progress retryable. No unsolicited provider push is implied.

Legacy cursor advancement is transport handoff, not durable application completion.
Opt-in [durable admission](DURABLE_ADMISSION.md) atomically retains inbox bytes with
cursor advancement and requires explicit application dispositions. Neither mode
makes parser completion an authenticated business receipt.

## Administration and discovery

POST /mailboxes takes raw CESR containing controller KEL, optional delegation
replay and a terminal signed end/role add or cut for the hosted mailbox AID.
Normal KERI processing must accept the update; accepted ends state is authority.
There is no parallel admin grant store or signature bypass.

Expose origin-rooted controller/mailbox/witness OOBIs from accepted endpoint
state. Path-prefixed mailbox OOBIs are outside this model. Discovery, authorization
update, payload storage and private retrieval are separate checks.

## Lifecycle and limits

One runtime/listener selects hosted identities explicitly. Close response streams
before listener drain; release LMDB cursors before transport suspension. Existing
per-record/SSE caps do not cover provider connection count, whole-row pre-allocation
or aggregate runtime memory. Those remain [resource](../../plans/runtime/RESOURCE_POLICY_PLAN.md),
[storage](../../plans/db/STORAGE_RECOVERY_PLAN.md) and
[transport](../../plans/runtime/TRANSPORT_PLAN.md) obligations.
