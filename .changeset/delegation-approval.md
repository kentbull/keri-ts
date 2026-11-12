---
"keri-ts": minor
---

Add `listPendingDelegations`, `approveDelegation`, `delegationApprovalStatus`, `settleDelegationApproval`, `waitForDelegationApproval` and `dismissDelegation` to `keri-ts/runtime`. They own a single-signature delegator's approval of a delegate's pending `dip` or `drt`: discovery from the `delegables.` escrow, the anchoring event, witness receipts, the witness-log request for the delegate and the wait for the delegate's event. A repeated approval finds the anchor in the delegator's KEL and never anchors twice. `tufa delegate confirm` now calls them with unchanged behavior for single-signature delegators; the group path is unchanged.
