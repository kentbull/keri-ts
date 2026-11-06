---
"keri-ts": patch
---

`multisig rotate` now commits the accepted rotation's signing and rotation members for the proposer, as `multisig join` already did for a joiner. Previously a proposer whose rotation added a member kept its old member list, so later group proposals, such as the newcomer's agent role, were never sent to the new member.
