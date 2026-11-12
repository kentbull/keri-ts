---
"keri-ts": minor
---

A group delegator approves a delegated event through the group proposal API. `proposeGroupDelegationApproval` (exported from `keri-ts/runtime`) proposes the group interaction that seals the delegated event, hands it to the Counselor and publishes it to the other members, who approve it with `approveGroupProposal`; it returns null once the group's KEL already holds the anchor. `requestDelegatedEvent` then asks the delegate's witness for the delegated event, and `delegationApprovalStatus` / `listPendingDelegations` already work for a group delegator. `tufa delegate confirm --interact` on a group calls these instead of its own `interactGroupHab` flow and hand-built `/multisig/ixn` message; the printed lines are unchanged, and the second run now waits for the anchor's witness receipts before asking for the delegate's event. The CLI-held group branch is removed rather than wrapped; backward compatibility with 2.1.0 is not a goal for 2.2.0.
