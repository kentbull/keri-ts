# ADR-0009: Mailbox Architecture

- Status: Accepted
- Date: 2026-04-05
- Scope: `packages/keri` mailbox storage, forwarding, polling, admin, and
  interoperability architecture
- Related:
  - `docs/adr/adr-0003-agent-runtime-composition-root.md`
  - `docs/adr/adr-0004-cue-runtime-portability.md`
  - `docs/adr/adr-0008-escrow-decision-architecture.md`
  - `docs/adr/adr-0010-signed-keri-http-ingress.md`
  - `docs/design-docs/mailbox/MAILBOX.md`
  - `docs/design-docs/runtime/CUES.md`
  - `packages/keri/src/db/mailboxing.ts`
  - `packages/keri/src/app/forwarding.ts`
  - `packages/keri/src/app/mailbox-director.ts`
  - `packages/keri/src/app/server.ts`

## Context

Mailboxes are one of the most heavily studied parts of the KERIpy reference
implementation because they operationalize a core promise of the protocol stack:

- a controller can be offline
- communications can still be delivered for later pickup
- the controller can reconnect and catch up without changing the underlying KERI
  exchange, reply, replay, or receipt semantics

KERIpy spreads that behavior across several cooperating pieces:

- `Mailboxer` provides durable topic-indexed message storage
- `Poster` and `ForwardHandler` route and store forwarded traffic
- witness and indirect-mode HTTP handlers expose mailbox query and storage
  behavior
- mailbox CLI commands expose operator workflows such as add, list, update, and
  debug

`keri-ts` now has those same concerns, but not the same runtime shape:

- runtime work is organized around `AgentRuntime`, `Reactor`, `Exchanger`, and
  explicit cue/runtime bridges instead of HIO doers
- mailbox add/remove flows are implemented through the long-lived `tufa agent`
  host plus `POST /mailboxes`
- `keri-ts` supports an optional CESR "body" mode for Tufa-to-Tufa mailbox
  traffic, while KERIpy interop remains centered on the body-plus-header wire
  contract

Without an ADR-level statement, maintainers must reverse-engineer which parts of
the mailbox story are KERIpy parity, which parts are `keri-ts` architecture, and
which parts are Tufa-only extensions.

## Decision

`keri-ts` standardizes on the following mailbox architecture:

- a mailbox is a recipient-side relay endpoint, not a sender-side mediator
- mailbox authorization truth lives in accepted `/end/role` state
- ordinary Poster traverses controller, agent and mailbox roles in that order:
  all direct endpoints, then one random mailbox; only absence of those roles
  permits witness delivery
- an explicitly composed provider store short-circuits any eligible local mailbox
  or witness AID, without requiring a URL; it does not consume the stored payload
- this supersedes the former mailbox-first/broadcast-all selection policy
- mailbox storage belongs to a provider-side `Mailboxer` composed above `Habery`
- `MailboxDirector` owns provider query/stream lifetimes and topic registration;
  `MailboxPoller` owns concurrent HTTP/SSE consumer workers and publishes durable
  remote cursor progress only after each consumer finishes
- poll allowed mailbox providers and current KEL witnesses together; a shared AID
  gets one worker for its shared history. There is no local replay reader or
  separate bounded polling driver
- mailbox admin is handled by the remote mailbox host through `POST /mailboxes`
- mailbox admin request shape follows ADR-0010:
  - one raw `application/cesr` stream carrying controller replay and terminal
    signed `/end/role/add` or `/end/role/cut`
- `/fwd` only stores traffic when the addressed mailbox endpoint is currently
  authorized for the recipient controller

This architecture is KERIpy-shaped at the protocol and storage level, while
remaining explicit about the places where `keri-ts` has different runtime or
operational seams.

This ADR keeps mailbox storage, forwarding, authorization, and transport policy
in scope. The broader cue-system explanation, including why `mbx` query
streaming depends on `stream` cue routing and not just mailbox storage, lives in
`docs/design-docs/runtime/CUES.md`.

For the full end-to-end mailbox explainer, including the sender/recipient/
mailbox-provider split, `/fwd` as a provider transport wrapper, mailbox polling,
and the `POST /mailboxes` mental model across both KERIpy and `keri-ts`, see
`docs/design-docs/mailbox/MAILBOX.md`.

## Runtime And Data-Flow Mental Model

### Roles

- Recipient controller:
  - authorizes one or more mailbox providers for itself
  - polls those mailboxes later to recover unread traffic
- Mailbox provider:
  - hosts a non-transferable mailbox AID
  - accepts mailbox authorization through signed `/end/role/add` or
    `/end/role/cut`
  - stores forwarded traffic for authorized recipients
- Sender:
  - resolves recipient mailbox endpoints from accepted role and location state
  - forwards mailbox-eligible traffic to the recipient's authorized mailboxes

### Send Path

1. A sender builds a message such as an `exn`, reply, replay, or receipt-style
   payload.
2. The producer resolves recipient aliases and admits signed bytes to Poster.
3. Poster sends to every controller and agent endpoint, then one mailbox;
   witnesses apply only when none of those roles exists.
4. Direct targets receive the original message. An indirect target receives `/fwd`,
   or the composed provider store publishes the payload locally.
5. Failed outcomes preserve partial success; there is no automatic or durable retry.

### Forwarding (`/fwd`) Mechanics

Mailbox delivery to a remote mailbox provider is not the original message sent
raw to the provider. The provider-facing transport message is a forwarding
exchange whose job is to carry one addressed mailbox payload.

The important mental model is:

- outer message:
  - signed `exn` on route `/fwd`
- outer modifiers:
  - `q.pre` is the intended recipient controller prefix
  - `q.topic` is the mailbox topic bucket such as `/challenge`
- legacy v1 payload: empty `a`, with the child SAD in `e.evt` and pathed
  attachment evidence for `/e/evt`
- v2 payload: signed `a.evt` digest binds one nested child body; that child retains
  independent signature and attachment evidence

So the provider receives a forwarding envelope, not the final mailbox payload as
the top-level request message.

In current `keri-ts`, mailbox posting may also include sender context material
ahead of the `/fwd` exchange, such as sender end-role reply material. That
context helps the receiving runtime accept the sender and parse the forwarding
message in one CESR request stream. The mailbox payload, however, is still the
embedded message addressed by the `/fwd` exchange.

#### Local Short-Circuit

If a provider store is composed and any eligible mailbox AID is local, `Poster` does not
wrap the message in `/fwd` and round-trip through HTTP. It stores the original
payload directly into `Mailboxer` under `recipient/topic`.

That is an optimization of transport, not a change in mailbox semantics. The
stored mailbox payload remains the inner message the recipient is supposed to
consume later.

#### Remote Provider Behavior

When the mailbox host receives `/fwd`:

1. it parses the CESR request stream normally
2. `ForwardHandler` verifies that the top-level message is a `/fwd` exchange
3. it extracts `recipient` and `topic` from `q.pre` and `q.topic`
4. it reconstructs the embedded payload from:
   - the embedded `e.evt` SAD
   - any pathed attachment groups targeting `/e/evt`
5. it verifies that the mailbox AID which received the request is currently
   authorized for `[recipient, mailbox, mailboxAid]`
6. only then does it store the reconstructed embedded payload into `Mailboxer`

The provider does not store the outer `/fwd` envelope as mailbox traffic. It
stores the reconstructed inner message that the eventual recipient will ingest.

#### What The Recipient Later Polls

`mbx` query and SSE mailbox streaming return the stored inner payload bytes from
`Mailboxer`, not the outer `/fwd` wrapper.

That means recipient polling sees the original message type that matters for
application behavior:

- `/challenge/response` exchanges
- replies
- replays
- receipts
- other mailbox-topic payloads

The forwarding envelope is therefore a provider transport mechanism, not part of
the recipient's durable mailbox payload model.

### Provider Storage Path

1. The mailbox host receives a forwarded `/fwd` exchange.
2. `ForwardHandler` extracts the addressed recipient, topic, and embedded
   message.
3. The handler verifies that the mailbox AID that received the request is
   currently authorized for the addressed recipient.
4. The payload is stored in `Mailboxer` under the ordered topic bucket
   `recipient/topic`.

### Recipient Sync Path

1. `MailboxDirector` computes the next wanted topic indices from durable `tops.`
   cursor state.
2. `MailboxPoller` replays any local mailbox payloads and issues `mbx` queries
   to remote mailbox or witness endpoints.
3. Query acceptance emits a `stream` cue that starts mailbox SSE handling.
4. The mailbox host streams ordered mailbox payloads back as SSE events.
5. The runtime ingests those payloads through the normal parser, exchanger, and
   cue flows.
6. The last seen indices are persisted back into `tops.`.

The important split is:

- the `stream` cue starts transport work
- `Mailboxer` supplies the payload bytes
- each HTTP consumer awaits normal protocol acceptance before its provider cursor
  advances; finite commands use the same workers under an elapsed deadline
- timeout policy is split too:
  - short request-open guard for transport setup
  - longer mailbox poll duration for SSE long-poll reads
  - command deadlines cancel and join the same active workers before store closure

## Storage Model

### Mailboxer

`Mailboxer` is the provider-side inbound mailbox store.

- `.tpcs` stores ordered topic indices:
  - `(topic, on) -> digest`
- `.msgs` stores deduplicated message bodies:
  - `digest -> raw message bytes`

For forwarded mailbox delivery, the stored message body is the reconstructed
inner payload extracted from `/fwd`, not the outer forwarding envelope.

The important invariant is that `Mailboxer` stores recipient-side inbox
material, not sender retry state.

Ownership rule:

- `Mailboxer` scope is one habery environment
- `Mailboxer` is not a `Habery` field or dependency
- runtime/host composition opens and closes `Mailboxer` explicitly when
  provider-side mailbox behavior is needed

### Baser `tops.`

`tops.` stores durable remote mailbox cursor state.

- key:
  - `(recipient controller, mailbox or witness AID)`
- value:
  - `TopicsRecord` containing last seen topic indices

These are not stored in `Mailboxer` because they describe polling progress, not
provider-side stored messages. This durable cursor state remains habery-owned
through `Baser`.

## Mailbox Admin And Authorization

Mailbox add and remove are remote admin workflows, not local toggles.

### Add

1. The controller builds a signed `/end/role/add` reply authorizing
   `role=mailbox` for one mailbox AID.
2. The controller posts one raw `application/cesr` stream to the mailbox
   provider's `POST /mailboxes` endpoint:
   - controller KEL replay
   - optional delegation replay
   - terminal mailbox authorization `rpy`
3. The mailbox host verifies:
   - the terminal signed reply
   - `role == mailbox`
   - the target `eid` matches the mailbox AID hosted at that endpoint
4. The mailbox host ingests the whole stream through the normal KERI pipeline
   and confirms accepted `ends.` state matches the request.
5. On success, the controller ingests the same reply locally and publishes
   current mailbox role state so other parties can discover the mailbox.

### Remove

1. The controller builds `/end/role/cut`.
2. The same `POST /mailboxes` flow is used.
3. On success:
   - local state is updated
   - future mailbox-targeted sends stop using that mailbox

### Authorization Boundary

`/fwd` acceptance is mailbox-aware and host-aware:

- the receiving host resolves which local mailbox AID received the request
- storage only happens when accepted `/end/role` state says the recipient has
  currently authorized that mailbox AID
- the authorization check is evaluated against the addressed mailbox endpoint
  that actually received the request, not just against payload claims inside the
  forwarding exchange

That means mailbox authorization is enforced at both send selection and inbound
storage.

## Transport And Interoperability Rules

### KERIpy Correspondence

KERIpy sends one CESR message per HTTP request:

- the message body goes in the HTTP request body
- attachments go in `CESR-ATTACHMENT`
- forwarded mailbox requests still follow this rule, so embedded `/fwd`
  attachment material is split per message request, not shoved into one large
  opaque stream

`keri-ts` treats that as the default interop contract.

Mailbox admin is the notable exception because it submits one already assembled
multi-message KERI stream. That still follows ADR-0010 because the request body
remains KERI-native CESR bytes instead of a multipart or JSON wrapper.

### Current `keri-ts` Difference

`keri-ts` supports a Tufa-only mailbox option named "body" mode where the full
CESR stream is sent in the request body. This mode is not assumed for KERIpy
interop and must be treated as an explicit local extension.

### Canonical Root Hosting

Mailbox hosts are served from the origin root.

This means the advertised mailbox URL is origin-rooted HTTP(S):

- `http(s)://host[:port]`

Mailbox discovery and admin then use the normal KERIpy route shapes:

- `/oobi/{aid}/{role}/{eid?}`
- `POST /mailboxes`

### Multi-Mailbox Delivery

If a recipient has several authorized mailbox endpoints, ordinary Poster chooses
one randomly (or uses an eligible local provider store). There is no broadcast-all
mailbox policy or user delivery-mode override.

## Consequences And Non-Goals

### Consequences

- mailbox behavior is shared per habery environment, but provider mailbox
  storage is composed and owned above `Habery` by runtime/host layers
- mailbox role state is the authority for send selection and inbound storage
- maintainers must document KERIpy parity and `keri-ts` deltas explicitly when
  changing mailbox behavior
- mailbox startup must reject path-bearing provider URLs instead of silently
  treating those paths as hosted mailbox namespaces

### Non-Goals In This ADR

- mailbox-provider migration or redirect forwarding
- priority routing between multiple mailboxes
- adding sender retry durability without a separately approved design
- replacing normal parser or exchanger ingestion with mailbox-specific side
  channels

## Appendix: Maintainer Debugging

Use `tufa db dump` selectively. The goal is to inspect the domain that owns the
state you care about, not to dump everything.

Common mental model:

- `baser`
  - list available base stores
- `baser.<subdb>`
  - inspect one protocol store such as `baser.ends` or `baser.tops`
- `mailboxer`
  - list mailbox provider-side stores
- `mailboxer.<subdb>`
  - inspect `mailboxer.tpcs` or `mailboxer.msgs`

Operational rule:

- inspect `baser.ends` to understand authorization truth
- inspect `baser.tops` to understand remote poll cursor state
- inspect `mailboxer.*` to understand provider-side stored mailbox traffic

If mailbox storage looks correct but `mbx` queries still hang, inspect the cue
bridge next. The common failure mode is not missing stored data; it is broken
`stream` cue routing between query acceptance and the SSE responder.
