# ADR-0010: Signed KERI HTTP Ingress Uses KERI-Native Wire Shapes

- Status: Accepted
- Date: 2026-04-07
- Scope: `packages/keri` HTTP endpoints that carry signed KERI material
- Related:
  - `docs/adr/adr-0009-mailbox-architecture.md`
  - `docs/design-docs/keri/MAILBOX_ARCHITECTURE_ACROSS_KERIPY_AND_KERI_TS.md`
  - `packages/keri/src/app/cesr-http.ts`
  - `packages/keri/src/app/server.ts`
  - `packages/keri/src/app/cli/mailbox.ts`

## Context

Some HTTP routes in `keri-ts` carry ordinary operator input.

Some carry already-authoritative signed KERI material.

Those two classes are not interchangeable. When maintainers blur them together,
the code drifts toward wrappers that teach the wrong mental model:

- multipart fields around existing KERI messages
- JSON envelopes around signed artifacts that already have a wire format
- new `exn` wrappers for flows that are not actually peer protocols

`POST /mailboxes` exposed that drift clearly. The authority in that flow is not
an HTTP form field. It is the signed `/end/role/add` or `/end/role/cut` reply
and the accepted `ends.` state produced after normal KERI ingestion.

KERIpy is the behavioral reference here:

- ordinary CESR-over-HTTP uses one message body plus `CESR-ATTACHMENT`
- precomposed multi-message KERI submissions should still arrive as KERI bytes,
  not as ad hoc REST wrappers

## Decision

`keri-ts` classifies HTTP endpoints that touch KERI material into three
distinct patterns.

### 1. KERI-native ingress endpoints

Use direct CESR bytes or CESR-over-HTTP framing when the request carries
existing signed KERI material.

Rules:

- keep the request body in KERI-native wire form
- use helpers in `packages/keri/src/app/cesr-http.ts`
- do not wrap existing KERI messages in JSON or multipart form data just to get
  them through HTTP

Examples:

- general runtime protocol ingress on `POST /` and `PUT /`
- mailbox admin on `POST /mailboxes`

### 2. Peer protocol endpoints

Use `exn` only when the interaction is actually a named peer protocol with its
own route, behavior, and handler semantics.

Rules:

- `exn` is for protocol meaning, not for generic transport wrapping
- do not invent mailbox-specific `exn` envelopes just to carry an existing
  signed reply

Examples:

- forwarding `/fwd`
- challenge, IPEX, and other peer workflows

### 3. Plain REST/operator endpoints

Use JSON, query params, or other ordinary HTTP shapes only for non-authoritative
operator, discovery, or configuration input.

Examples:

- startup/config loading
- health checks
- non-signed debug or operator surfaces

## `/mailboxes` Classification

`POST /mailboxes` is a class-1 KERI-native ingress endpoint.

It is not:

- a mailbox-specific `exn` protocol
- a generic REST wrapper around mailbox policy
- a mailbox factory API

Its request contract is:

- `Content-Type: application/cesr`
- body is one raw CESR stream
- earlier messages supply controller KEL replay
- delegated controllers may include delegation replay
- the terminal message is the signed mailbox authorization `rpy`

The terminal `rpy` must satisfy:

- route is `/end/role/add` or `/end/role/cut`
- `a.role == mailbox`
- `a.eid == hosted mailbox AID`

The authority remains:

1. the signed terminal `/end/role/*` reply
2. the accepted `ends.` state produced after normal ingestion

## `keri-ts` Enforcement Seam

`packages/keri/src/app/cesr-http.ts` is the shared seam for this pattern.

Server-side direct signed-KERI ingress should use helpers from that module for:

- request framing validation
- canonical CESR byte reconstruction
- message inspection when an endpoint cares about the first or terminal message

Client-side direct signed-KERI submission should use helpers from that module
for:

- ordinary one-message CESR-over-HTTP requests
- raw CESR stream requests when the endpoint accepts a preassembled stream

This keeps request-shape policy out of individual handlers and makes the
approved transport boundary visible in one place.

## Consequences

- `POST /mailboxes` now accepts one raw CESR stream instead of multipart
  `kel` / `delkel` / `rpy` fields
- mailbox add/remove clients post raw CESR bytes
- maintainers should reach for CESR helpers before inventing new HTTP wrappers
  for signed KERI submissions
- if a future workflow genuinely needs a new peer protocol, define that as a
  protocol decision first, then use `exn`

## Non-Goals

- banning JSON for every HTTP endpoint
- replacing existing peer protocols with mailbox admin
- declaring that every multi-message request must use one exact framing shape
  outside the KERI-native ingress class
