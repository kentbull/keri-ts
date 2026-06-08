# Attachment Counter `gvrsn` Maintainer Guide

## Purpose

Capture the maintainer contract for KERI attachment counter version selection in
`keri-ts`.

This guide covers the current branch behavior where live message serialization
can use caller/requested `gvrsn`, while stored KEL/TEL replay streams preserve
their historical counter version.

## Core Rule

Attachment counter versioning is a live-message framing concern unless the code
is replaying already stored event material.

- Live message builders may choose or promote `gvrsn`.
- Nested/enclosed messages require v2 attachment framing.
- A serder's own `gvrsn` or `pvrsn` can raise the attachment version floor.
- KEL/TEL clone and replay APIs must preserve stored bytes and should stay on
  v1 counter framing unless they are intentionally constructing a new live
  envelope.

## Source Ownership

- `packages/keri/src/core/attachment-countering.ts` owns semantic counter-name
  to CESR v1/v2 code selection.
- `packages/keri/src/core/protocol-serialization.ts` owns live KERI/ACDC
  attachment serialization and `gvrsn` promotion for constructed messages.
- `packages/keri/src/db/basing.ts` and `packages/keri/src/db/reger.ts` own
  stored KEL/TEL replay streams; those paths are not generic live serializers.

## Maintainer Checks

- If a path is constructing a new message for exchange, credential delivery, or
  direct HTTP send, use the live serialization helpers and pass `gvrsn` when
  the caller exposes it.
- If a path is cloning stored KEL/TEL material for replay or support streams,
  preserve the stored event semantics; do not silently upgrade counters.
- If a payload length is not quadlet-aligned, fail at the framing helper instead
  of allowing malformed attachments to reach KERIpy or Sally.

## Failure Conditions

- Replaying old KEL/TEL material through live v2 framing changes interop bytes.
- Treating v2 counter counts as item counts instead of payload quadlets produces
  invalid attachment groups.
- Adding direct `Counter` construction in app or VDR code duplicates policy that
  belongs in `attachment-countering.ts`.
