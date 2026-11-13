---
"keri-ts": patch
---

A `/multisig` wrapper is checked before it is stored, noticed or listed: one addressed to an identifier the receiver does not hold, or sent by an identifier that is not a signing member of a group the receiver is in, is refused. A member that only receives takes a group interaction (or a registry proposal's anchor) that the proposer's signature already completes on receipt, without approving it; approving remains the way to add a signature. A proposal whose event is already accepted in the local KEL lists as `inapplicable` rather than `unapproved`. A receipt cue for the runtime's own group no longer tries to deliver to a group with no end roles. Rotations and replies still wait for approval; the lead does not yet forward a completed event to members that never saw its signatures.
