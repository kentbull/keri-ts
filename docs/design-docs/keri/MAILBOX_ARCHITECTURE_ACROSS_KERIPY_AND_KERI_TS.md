# Mailbox Architecture Across KERIpy And `keri-ts`

Date: 2026-04-07

## Purpose

Capture the maintainer mental model for mailboxes across both runtimes.

This document is the primary explainer for:

- what a mailbox is
- which AIDs participate in mailbox delivery
- how `/fwd` storage actually works
- what mailbox polling and `mbx` query streaming do
- why mailbox authorization is a recipient-to-mailbox relationship
- what `POST /mailboxes` is and is not
- how KERIpy's witness-coupled mailbox behavior maps onto `keri-ts`

KERIpy remains the behavioral reference implementation. `keri-ts` follows the
same protocol and storage shape while making runtime ownership and host seams
more explicit.

`docs/adr/adr-0009-mailbox-architecture.md` remains the normative `keri-ts`
architecture decision. This document is broader: it teaches the whole mailbox
system end to end and grounds that explanation in both KERIpy and `keri-ts`
code.

For the general HTTP design rule behind mailbox admin request shape, see
`docs/adr/adr-0010-signed-keri-http-ingress.md`.

## Verdict

A mailbox is a recipient-chosen storage provider for later pickup.

It is not:

- the sender
- the final recipient
- an active relay that immediately pushes traffic onward
- a mailbox-per-controller factory created on demand by admin requests

Two mailbox facts are critical and non-negotiable:

1. Mailbox retrieval is poll-driven.
   - The mailbox does not push inbox payloads directly to the recipient.
   - The recipient must issue `qry route=mbx`.
   - The mailbox host then streams unread stored payloads back over SSE.
2. Remote mailbox delivery is `/fwd`-wrapped.
   - The sender does not send the final application payload as the top-level
     message to a remote mailbox provider.
   - The sender wraps it in `/fwd`.
   - The mailbox host unwraps the inner payload and stores that inner payload
     under `recipient/topic`.

The durable mental model is:

1. A recipient controller authorizes one mailbox provider AID for itself.
2. A sender wraps recipient-directed traffic in `/fwd` and posts it to that
   mailbox provider.
3. The mailbox provider unwraps the inner payload and stores it in mailbox
   storage for that recipient.
4. The recipient later polls with `qry route=mbx`.
5. The mailbox provider streams stored payloads back to the recipient over SSE.

The most important security rule is:

- provider-side mailbox storage must only happen when current accepted
  end-role state says that the addressed recipient has authorized that mailbox
  provider

That rule is implicit in witness-coupled mailbox behavior and must be made
explicit when mailbox hosting is decoupled from witnessing.

## The Three Identities

Most mailbox confusion comes from mixing up these roles.

### Sender Controller

- builds the original application or protocol message
- chooses transport based on recipient endpoint role state
- sends direct when appropriate
- wraps traffic in `/fwd` when using a mailbox provider

### Recipient Controller

- is the true destination of the inner payload
- authorizes one or more mailbox providers for itself through `/end/role`
  replies
- later polls mailboxes to recover stored traffic

### Mailbox Provider AID

- is a local AID hosted by the mailbox server
- is not the final recipient of forwarded traffic
- stores inbox material for later pickup by recipients
- answers mailbox OOBI, mailbox admin, and mailbox query routes

In `/fwd`, `q.pre` names the recipient controller, not the mailbox AID.

## KERIpy Mailbox Shape

KERIpy's mailbox behavior is spread across several cooperating pieces:

- `Poster` and `StreamPoster` decide how to deliver recipient-directed traffic
- `ForwardHandler` receives `/fwd` and stores mailbox payloads
- `Mailboxer` stores topic-indexed payload bytes
- `Poller` issues `qry route=mbx` requests to mailboxes and witnesses
- `HttpEnd` serves mailbox query responses as SSE
- `MailboxStart` routes `stream` cues to the mailbox query response queue

Important code seams:

- `keripy/src/keri/app/forwarding.py`
- `keripy/src/keri/app/storing.py`
- `keripy/src/keri/app/indirecting.py`
- `keripy/src/keri/core/eventing.py`
- `keripy/src/keri/end/ending.py`

Historically, mailbox behavior in KERIpy is tightly coupled to witness hosting:

- witnesses already have a trust relationship with the recipient's KEL state
- witness mailbox storage piggybacks on that relationship
- polling logic often treats authorized mailboxes and witnesses as one family of
  remote inbox providers

That coupling is the thing `keri-ts` is intentionally separating. The goal is
not to change mailbox semantics. The goal is to preserve witness-style mailbox
semantics without requiring witness receipts and witness topology.

## `keri-ts` Mailbox Shape

`keri-ts` keeps the same conceptual architecture, but splits ownership more
explicitly:

- `Poster` owns mailbox-first send policy
- `MailboxDirector` owns provider mailbox storage access and mailbox query
  streaming
- `MailboxPoller` owns remote mailbox retrieval
- `Mailboxer` remains provider-side inbox storage
- `tops.` remains recipient-side durable remote cursor state
- `POST /mailboxes` is the host seam for mailbox add/remove authorization
- `tufa mailbox start` hosts one selected mailbox AID, not an arbitrary
  per-request mailbox factory

Important code seams:

- `packages/keri/src/app/forwarding.ts`
- `packages/keri/src/app/mailbox-director.ts`
- `packages/keri/src/app/mailboxing.ts`
- `packages/keri/src/app/server.ts`
- `packages/keri/src/app/cli/mailbox.ts`
- `packages/keri/src/db/mailboxing.ts`

## Send Path

### KERIpy

At send time, KERIpy `Poster` looks up endpoint roles for the recipient:

- if controller, agent, or mailbox endpoints exist, it uses those
- otherwise, if witnesses exist, it uses witnesses

For mailbox delivery:

1. sender resolves recipient mailbox endpoints
2. sender creates `/fwd`
3. sender posts `/fwd` to one mailbox provider

Relevant code:

- `Poster.deliverDo(...)`
- `Poster.forward(...)`
- `Poster.forwardToWitness(...)`

### `keri-ts`

`keri-ts` is mailbox-first by policy:

1. resolve recipient mailbox endpoints from accepted state
2. if mailbox endpoints exist, send to all of them
3. if no mailbox endpoints exist, fall back to direct controller or agent
4. queue sender-side retry state in `Outboxer` when enabled and mailbox-target
   delivery fails

This is a `keri-ts` operational difference, but it preserves the core KERIpy
idea that mailbox delivery is recipient-side store-and-forward, not a different
message family.

## What `/fwd` Really Means

The mailbox provider does not receive the original application message as the
top-level transport object.

It receives an exchange whose route is `/fwd`.

This is one of the core mailbox invariants:

- for remote mailbox delivery, the sender always posts `/fwd`
- the provider stores the reconstructed inner payload, not the `/fwd` wrapper
- the recipient later polls and receives the stored inner payload, not the
  `/fwd` wrapper

Mental model:

- outer message:
  - `exn` route `/fwd`
- outer modifiers:
  - `q.pre` = recipient controller AID
  - `q.topic` = mailbox topic bucket
- embedded payload:
  - `e.evt` = the actual inner message to be stored for the recipient
- embedded attachments:
  - pathed attachment groups pointing at `/e/evt`

So `/fwd` is a provider transport wrapper, not the durable mailbox payload.

The durable mailbox payload is the reconstructed inner message.

Do not blur these two layers together:

- sender-to-provider transport object: `/fwd`
- provider-to-recipient stored mailbox object: inner payload under
  `recipient/topic`

### What The Mailbox Host Does With `/fwd`

1. parse the outer `/fwd`
2. identify the recipient from `q.pre`
3. identify the topic from `q.topic`
4. reconstruct the inner message from `e.evt` plus pathed attachments
5. store that inner message under `recipient/topic`

This is true in both runtimes.

### Important `keri-ts` And KERIpy Nuance

There is one optimization that should not be mistaken for a semantic change:

- if the selected mailbox is local to the same running environment, the sender
  can short-circuit and store the inner payload directly instead of performing a
  real remote `/fwd` HTTP hop

That optimization does not change the remote mailbox contract.

For a real remote mailbox provider, `/fwd` is still the transport wrapper.

## The Storage Boundary

### `Mailboxer`

`Mailboxer` is provider-side inbox storage.

It stores:

- ordered topic index entries in `.tpcs`
- message bodies in `.msgs`

The stored bytes are the inner payload the recipient should later ingest, not
the outer `/fwd` wrapper.

### `tops.`

`tops.` is not mailbox payload storage.

It stores recipient-side durable cursor state:

- `(recipient pre, mailbox/witness eid) -> topic -> last seen index`

This is what mailbox polling advances.

That split matters:

- `Mailboxer` answers "what payloads exist?"
- `tops.` answers "what has this recipient already seen from this provider?"

## Why `AuthorizedForwardHandler` Exists

### The Problem

Generic KERIpy `ForwardHandler` is intentionally simple.

It trusts that the host exposing `/fwd` is already the right storage boundary.
It:

- extracts recipient and topic
- reconstructs the inner payload
- stores it

It does not ask:

- did this recipient authorize this mailbox provider?
- is the local mailbox AID that received this request actually allowed to store
  for that recipient?

That simplicity is acceptable in the older witness-coupled mental model because
the witness/mailbox boundary is implicit in witness hosting.

It is not acceptable for a decoupled mailbox host.

### The Rule It Enforces

`AuthorizedForwardHandler` enforces:

- storage is allowed only when accepted `ends.` state currently says
  `(recipient, Roles.mailbox, mailboxAid)` is allowed

This is not sender authorization.

It is not:

- "does the mailbox trust this sender?"
- "does the mailbox have a local allowlist for this sender?"

It is:

- "has the recipient controller chosen this mailbox provider for itself?"

That is the right storage boundary.

### What Gets Dropped

Yes, unauthorized `/fwd` storage attempts should be dropped.

More precisely:

- if recipient `A` has authorized mailbox `M`, then host `M` may store `/fwd`
  traffic addressed to `A`
- if recipient `A` has not authorized mailbox `M`, then host `M` must not store
  that traffic

The current policy does not require sender allowlisting. Once recipient `A`
chooses mailbox `M`, senders may deliver addressed traffic to `M` for `A`.

### Where It Lives

It lives on the mailbox host's `/fwd` handling path.

KERIpy wiring:

- witness host: `ForwardHandler`
- mailbox host on `mailbox-impl`: `AuthorizedForwardHandler`

In `keri-ts`, the same concept appears as request-path-aware mailbox storage
gating in the host/runtime layer rather than by reusing the exact Python class
shape.

## Mailbox Polling And `mbx`

Mailbox hosts do not push stored messages directly to recipients.

Recipients poll.

This is the other core mailbox invariant:

- inbox delivery is not push-based
- the mailbox host waits for recipient polling
- unread stored payloads are returned only through the recipient's `mbx` query
  flow

### KERIpy Poll Path

1. recipient poller builds `qry route=mbx`
2. mailbox host accepts the query
3. `Kevery.processQuery("mbx")` emits a `stream` cue
4. `MailboxStart.cueDo()` routes that cue to `HttpEnd.qrycues`
5. `QryRpyMailboxIterable` matches the cue to the query SAID
6. `MailboxIterable` reads payloads from `Mailboxer`
7. SSE events stream back to the recipient
8. recipient updates `tops.`

The mailbox host therefore behaves like:

- a durable inbox keyed by `recipient/topic`
- an SSE query responder for `mbx`

It does not behave like:

- a direct push transport that initiates delivery to the recipient on its own

### `keri-ts` Poll Path

The same semantics exist with more explicit runtime components:

1. `MailboxPoller` computes wanted cursors from `tops.`
2. runtime sends `qry route=mbx`
3. accepted query becomes a typed `stream` cue
4. host sink and `MailboxDirector` correlate the stream request
5. `MailboxDirector` reads payloads from `Mailboxer`
6. recipient ingests returned payloads normally
7. `tops.` advances

For the deeper cue model, see
`docs/design-docs/keri/CUE_ARCHITECTURE_CROSS_RUNTIME.md`.

## Does Everything Mailbox-Related Need The Same Authorization Check

Not every mailbox route is the same kind of boundary.

### `/fwd`

This is the provider-side storage choke point.

If you are asking:

- "what externally delivered path causes provider inbox storage?"

the answer is `/fwd`.

That is why mailbox authorization must be enforced there.

### `qry route=mbx`

This is retrieval, not storage.

KERIpy's current `processQuery("mbx")` path is comparatively permissive. It
checks that the queried prefix exists, then emits a `stream` cue. It does not
obviously enforce the same recipient-to-mailbox authorization rule that `/fwd`
needs for storage.

That means:

- if we want faithful reproduction of current KERIpy behavior, `/fwd` storage
  authorization is the immediate must-have
- if we want a stronger overall mailbox security model, mailbox read-path policy
  is a separate design question worth challenging explicitly

Do not collapse those two questions into one.

### OOBI Routes

Mailbox OOBI routes are discovery surfaces.

Mailbox hosts should expose the normal KERIpy OOBI shape at the origin root:

- `http(s)://host[:port]/oobi/{aid}/controller`
- `http(s)://host[:port]/oobi/{aid}/mailbox/{eid}`
- `http(s)://host[:port]/oobi/{aid}/witness/{eid?}`

Path-prefixed mailbox OOBIs such as `http(s)://host[:port}/{prefix}/oobi/...`
are not part of the mailbox architecture model. Mailbox startup material should
use origin-rooted provider URLs, and mailbox OOBI generation should derive
canonical root OOBIs from that origin.

They should only disclose mailbox role state that accepted local state actually
authorizes, but they are not the same as inbox storage.

### `/mailboxes`

This route is not mailbox payload ingress.
It is mailbox authorization update ingress.

It therefore needs verification of signed end-role update material, not the
same storage gating as `/fwd`.

## Mailbox Admin Mental Model

"Admin" is easy to misread here.

It does not mean:

- shell access to the mailbox host
- operator-created mailboxes on demand
- arbitrary management of another controller's policy

It means:

- a mailbox-provider endpoint that accepts signed mailbox authorization updates
  from controllers

### Who Is Doing The Administration

The controller is administering its own relationship to the mailbox provider.

The provider is not deciding policy for the controller.

The controller says:

- "I authorize mailbox AID `M` for myself"

by sending signed `/end/role/add` or `/end/role/cut`.

The mailbox host only:

- verifies that material
- ingests it through the normal parser/reply stack
- checks whether accepted state now reflects the requested authorization

### `POST /mailboxes` Add Flow

Grounded in KERIpy:

1. controller builds signed `/end/role/add` with:
   - `cid = controller pre`
   - `role = mailbox`
   - `eid = mailbox provider pre`
2. controller builds one raw CESR stream:
   - controller KEL replay
   - optional delegation replay
   - terminal signed mailbox authorization `rpy`
3. controller posts that raw `application/cesr` stream to `/mailboxes`
4. mailbox host verifies:
   - the stream ends in `rpy`
   - terminal route is `/end/role/add` or `/end/role/cut`
   - `role == mailbox`
   - target `eid` equals the hosted mailbox AID
5. mailbox host ingests the whole CESR stream through normal KERI processing
6. mailbox host checks local accepted `ends.` state
7. on success, the relationship `(controller, mailbox, hostedMailboxAid)` is
   now authoritative local state

ASCII sequence:

```text
Controller C                     Mailbox Host M                    Local KERI State On M
------------                     --------------                    ---------------------
build raw CESR stream:
  kel
  optional delkel
  rpy: /end/role/add
    cid=C, role=mailbox, eid=M
        |
        | POST /mailboxes (application/cesr stream)
        |-------------------------------------------->|
        |                                             | inspect terminal rpy
        |                                             | verify route == /end/role/add or /cut
        |                                             | verify role == mailbox
        |                                             | verify eid == hosted mailbox AID M
        |                                             | ingest full CESR stream
        |                                             |------------------------------> ends[(C, mailbox, M)] = allowed
        |                                             | check accepted state reflects request
        |<--------------------------------------------|
        |                200 OK if accepted
```

### What `POST /mailboxes` Does Not Do

It does not:

- create a brand-new mailbox AID for the requesting controller
- allow one controller to manage another controller's mailbox policy
- bypass signature verification
- invent a second authority store for mailbox grants

Accepted `ends.` state is the authority.

## Mailbox Host Startup Model

Both implementations assume the mailbox host already knows which mailbox AID it
is serving.

### KERIpy

`setupMailbox(...)` and `kli mailbox start` use one selected local alias.

That alias:

- must exist locally or be provisioned by the mailbox-start workflow
- must be non-transferable
- becomes the hosted mailbox AID for that process

The host then serves:

- mailbox OOBI
- mailbox query streaming
- mailbox admin
- `/fwd` storage

for that mailbox AID.

It is one mailbox host for one selected local mailbox identity.

### `keri-ts`

`tufa mailbox start` follows the same operational model:

- select one local alias
- ensure it is or becomes the mailbox AID
- reconcile local `loc`, `controller`, and `mailbox` self state
- host only that mailbox identity's routes

This is a host-ownership porcelain, not a mailbox factory API.

## End-To-End Sequences

These diagrams are intentionally redundant with the prose above. They exist so
maintainers can rehydrate the mailbox model quickly without re-reading the
whole document.

### Sequence 1: Mailbox Add

```text
Recipient Controller C           Mailbox Provider M
----------------------           ------------------
choose mailbox provider M
build signed rpy:
  /end/role/add
  cid=C
  role=mailbox
  eid=M
build kel replay
        |
        | POST /mailboxes (raw application/cesr stream: kel, optional delkel, rpy)
        |-------------------------------------------->|
        |                                             | verify request targets hosted mailbox AID M
        |                                             | ingest CESR stream into normal KERI processing
        |                                             | accepted state now says:
        |                                             | ends[(C, mailbox, M)] = allowed
        |<--------------------------------------------|
        |                200 OK if accepted

Result:
  C has authorized mailbox provider M for itself.
```

### Sequence 2: Sender Delivers Through `/fwd`

```text
Sender S                         Mailbox Provider M                Mailbox Storage
--------                         ------------------                ---------------
resolve recipient C's
authorized mailbox endpoints
find mailbox M
build inner message
wrap inner message in /fwd:
  q.pre = C
  q.topic = /challenge (example)
  e.evt = inner message
        |
        | POST /fwd
        |-------------------------------------------->|
        |                                             | parse outer /fwd
        |                                             | identify recipient C from q.pre
        |                                             | identify topic from q.topic
        |                                             | reconstruct inner payload from e.evt + attachments
        |                                             | check accepted auth:
        |                                             | ends[(C, mailbox, M)] == allowed
        |                                             |---------------------------------> store under "C//challenge"
        |<--------------------------------------------|
        |                     204

Result:
  The mailbox stores the inner payload for recipient C.
  It does not store the outer /fwd wrapper as mailbox payload.
```

### Sequence 3: Recipient Polls With `mbx`

```text
Recipient Controller C           Mailbox Provider M                Mailbox Storage
----------------------           ------------------                ---------------
compute next wanted topic indices
from local tops. cursor state
build qry route=mbx
        |
        | POST qry(mbx)
        |-------------------------------------------->|
        |                                             | accept query
        |                                             | Kevery.processQuery("mbx")
        |                                             | emits stream cue
        |                                             | cue routing connects query to SSE responder
        |                                             |---------------------------------> read unread payloads under C/topic
        |<============================================|
        |        SSE stream of stored inner payloads
        |
ingest returned payloads normally
advance local tops. cursor state

Result:
  Retrieval is poll-driven.
  The mailbox host does not push traffic to C on its own.
```

## KERIpy To `keri-ts` Correspondence

| Concept                          | KERIpy                                         | `keri-ts`                                           |
| -------------------------------- | ---------------------------------------------- | --------------------------------------------------- |
| Provider inbox storage           | `Mailboxer`                                    | `Mailboxer`                                         |
| Outbound mailbox delivery policy | `Poster` / `StreamPoster`                      | `Poster`                                            |
| `/fwd` store path                | `ForwardHandler` or `AuthorizedForwardHandler` | forwarding handler plus hosted-mailbox gating       |
| Mailbox polling                  | `Poller` / `MailboxDirector`                   | `MailboxPoller` / `MailboxDirector`                 |
| Query streaming trigger          | `stream` cue                                   | typed `StreamCue`                                   |
| SSE mailbox response             | `HttpEnd` + `QryRpyMailboxIterable`            | host + `MailboxDirector.streamMailbox()`            |
| Mailbox host doer                | `MailboxStart`                                 | `createAgentRuntime(...)` + server host composition |
| Mailbox admin                    | `POST /mailboxes`                              | `POST /mailboxes`                                   |
| Auth truth                       | accepted `ends.`                               | accepted `ends.`                                    |

## Failure Modes To Watch For

### Wrong Recipient/Mailbox Mental Model

Symptom:

- treating mailbox AID as the final message recipient

Reality:

- mailbox AID is the storage provider
- recipient AID is `q.pre` and later `qry.i`

### Missing Storage Authorization

Symptom:

- mailbox host stores `/fwd` payloads for recipients that never authorized that
  host

Reality:

- `/fwd` storage must be gated by accepted mailbox end-role state

### Confusing Storage With Streaming

Symptom:

- mailbox payload is stored but `mbx` queries hang

Reality:

- mailbox storage and mailbox query response are separate paths
- the usual bug is broken `stream` cue routing, not missing stored payloads

### Treating `/mailboxes` As Mailbox Creation

Symptom:

- assuming mailbox provider will create mailbox identities per client request

Reality:

- mailbox host already serves one selected local mailbox AID
- `/mailboxes` only manages controller authorization for that hosted AID

## Maintainer Guidance

When changing mailbox code, ask these questions in order:

1. Who is the recipient controller?
2. Which mailbox AID is actually hosted by this request path or host process?
3. Is this code doing storage, retrieval, or authorization update?
4. If it is storage, what accepted state proves this host may store for that
   recipient?
5. If it is retrieval, are we preserving KERIpy behavior or intentionally
   strengthening it?

If those questions are not answered explicitly, the design is probably drifting.

## Related Documents

- `docs/adr/adr-0009-mailbox-architecture.md`
- `docs/design-docs/keri/CUE_ARCHITECTURE_CROSS_RUNTIME.md`
- `packages/keri/test/unit/app/mailbox-runtime.test.ts`
- `packages/keri/test/integration/app/interop-kli-tufa.test.ts`
