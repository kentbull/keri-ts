---
"keri-ts": patch
"@keri-ts/tufa": patch
---

Author group KEL (`/multisig/icp`, `/multisig/rot`, `/multisig/ixn`) and endpoint-role reply (`/multisig/rpy`) proposals in KERIpy's form for both v1 and v2 groups. That form is a v1 exchange wrapper whose named `e` embed carries the group-version child with its own attachment genus. Mixed KERIpy and Tufa groups now complete with v2 KELs, because `kli multisig join` reads only `e` embeds. An explicit v2 wrapper version still selects the nested form, and receiving accepts both forms.
