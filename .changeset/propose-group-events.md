---
"keri-ts": minor
---

Add `proposeGroupInception`, `proposeGroupRotation`, `proposeGroupInteraction` and `settleProposedRotation` to `keri-ts/runtime`. Each propose call creates this member's group event, hands it to the Counselor, publishes the proposal to the other members and returns the `GroupEventRef` without waiting; member add or remove is a rotation with new `smids` / `rmids`. `settleProposedRotation` commits a proposed rotation's members only once it is accepted, as KERIpy's `commitAcceptedMembers` does for the proposer. `GroupProposal.local` gains `inapplicable` for an already accepted event that names no local signing member, which is no longer reported as `unapproved`.
