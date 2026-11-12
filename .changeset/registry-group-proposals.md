---
"keri-ts": minor
---

`approveGroupProposal` now approves every group proposal kind: legacy registry and credential events (`vcp`, `iss`, `rev`) and ACDC v2 registry events (`rip`, `bup`), alongside key events and replies. `GroupApprovalDeps` gains `vdr`. Add `proposeRegistryEvent`, which authors the group anchor for an ACDC v2 registry event, hands it to the Counselor and publishes the proposal. `approvePendingMultisigProposal` behaves as before.
