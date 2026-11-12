---
"keri-ts": minor
---

Add `approveGroupProposal` to `keri-ts/runtime` for key-event (`icp`, `rot`, `ixn`) and endpoint-role reply (`rpy`) group proposals. It acts only on the wrapper SAID it is given and never prompts: it signs this member's contribution, sends it, hands the group event to the Counselor and returns the `GroupEventRef` without waiting for other members. A repeated call after a crash reuses the member's recorded signatures (read from `sigs.`) and its stored wrapper instead of signing or prompting again; `approvePendingMultisigProposal` shares that behaviour, so a crash between signing and storing the wrapper no longer asks the user a second time. `approvePendingMultisigProposal` and `MultisigApprovalCallbacks` are otherwise unchanged.
