---
"keri-ts": patch
---

`tufa multisig join` now answers a group KEL proposal in the proposal's own wrapper version. KERIpy `kli multisig rotate --version 2.0` proposes a v2 nested `/multisig/rot` wrapper and merges member contributions only under that wrapper's index key, so Tufa's v1 `e`-embed reply was never replayed and KERIpy's rotation stayed in its group partial-signature escrow. Approvals of v1 proposals are unchanged.
