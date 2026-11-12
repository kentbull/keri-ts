---
"keri-ts": minor
---

`approveAcdcV2Registry` takes a `resume` option that reuses this member's recorded signatures for the group anchor instead of signing it again after a crash between signing and acceptance. `approveGroupProposal` and `proposeRegistryEvent` set it for `rip` and `bup`; `approvePendingMultisigProposal` is unchanged. The `keri-ts` `check` task now also type-checks the unit test tree.
