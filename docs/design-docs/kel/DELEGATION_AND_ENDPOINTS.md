# Delegation, Multisig, And Endpoint Roles Maintainer Guide

## Purpose

Capture the current maintainer model for delegation confirmation, group
coordination, and endpoint-role authorization after the recent public multisig
CLI and mailbox authorization work.

## Delegation Confirmation

Delegator-side confirmation is driven by `delegables`, not by notification
messages.

- `/delegate/request` notices are operator visibility hints.
- `delegate confirm` must derive pending delegated events from durable escrow
  state.
- Confirmation anchors the delegated event from the delegator, waits for normal
  query/replay-backed commitment, then pins the authorizing source seal.
- Already accepted delegated events may still need source-seal repair when a
  later delegator replay exposes the anchor.

## Multisig Coordination

Normal individual and group KEL authoring emits KERI v2 inception, rotation and
interaction bodies with CESR v2 proofs. Existing Habitat methods provide this
default to the CLI without an extra mode or persistent version setting. Reopening
an identifier continues through its accepted KEL and keeper state.

Public group workflows now use the CLI boundary:

- `tufa multisig incept`
- `tufa multisig join`
- `tufa multisig interact`
- `tufa multisig rotate`
- `tufa multisig rpy`

The group coordination message is not the business event. `/multisig/*`
wrappers collect or distribute member approvals; the embedded KEL, TEL, reply,
or IPEX event remains the behavior that must eventually be accepted.
New ordinary KEL proposals use v2 nested wrappers, and the outer member signature
uses the same attachment genus as that wrapper. Existing receiving and explicit
serialization contracts are unchanged.

## Endpoint Roles

Endpoint-role state is accepted reply state, not startup configuration.

- `app/endpoint-roleing.ts` owns reusable group endpoint-role proposal helpers.
- `tufa ends add` and `tufa mailbox add --multisig-mode` share the group reply
  proposal path.
- Proposal results and CLI JSON report `proposals: [{ recipient, said }]` for the
  actual signed exchanges recorded locally and sent for each recipient.
  This replaces the former single `said` and `attachmentBytes` fields, which
  described an unused wrapper. A locally completed proposal with no remote
  recipients returns an empty list.
- Recipient-specific SAIDs identify the signed exchange for each recipient,
  including recipients sharing the same mailbox endpoint.
- Startup should not synthesize `/loc/scheme` or `/end/role/add` state when
  explicit endpoint config is missing.

## Maintainer Checks

- A group member may only sign with locally available member keys in signing
  index order.
- Inception and rotation use event-carried signing keys; endpoint-role reply
  endorsements use current accepted group key state.
- Do not treat a live agent and command-local CLI invocation as safe owners of
  the same store during interop tests.
- Use public `tufa multisig` commands in tests and scripts instead of private
  `Habery.makeGroupHab(...)` shortcuts when exercising operator workflows.

## Failure Conditions

- Routing delegation approval from notices bypasses durable escrow truth.
- Marking group prefixes accepted before validation can classify remote events
  as protected-party cases and skip the real approval gate.
- Auto-creating endpoint roles at host startup leaks system-managed assumptions
  into protocol state.
- Publishing endpoint-role proposals to local group members duplicates work and
  can confuse approval accounting.
