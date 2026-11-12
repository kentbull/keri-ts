---
"keri-ts": minor
---

Add `listGroupProposals`, `findGroupProposal` and `dismissGroupProposal` to `keri-ts/runtime`. They let a host that has no CLI see the group proposals (`icp`, `rot`, `ixn`, `rpy`, `vcp`, `iss`, `rev`, `rip`, `bup`) other members sent, show what approval will ask for (a group alias for a group not yet joined, a registry name) and dismiss a proposal's local notice. Listing is a pure read of stored exchange messages, the multisig index and the notifier, and pages past the 100-notice window. Dismissal removes notices only, because KERI has no reject message; the proposal can still be found by its SAID afterwards. Existing approval is unchanged.
