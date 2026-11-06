---
"keri-ts": patch
"@keri-ts/tufa": patch
---

Author group KEL (`/multisig/icp`, `/multisig/rot`, `/multisig/ixn`) and endpoint-role reply (`/multisig/rpy`) proposals in KERIpy's form for both v1 and v2 groups. That form is a v1 exchange wrapper whose named `e` embed carries the group-version child with its own attachment genus. Mixed KERIpy and Tufa groups now complete with v2 KELs, because `kli multisig join` reads only `e` embeds. An explicit v2 wrapper version still selects the nested form, and receiving accepts both forms.

A v2 member now forwards every message, including a v1 proposal, in a v2 nested `/fwd`. A v1 `/fwd`'s pathed couples cannot follow the member's v2 introduction, so a v2 witness could not store such a proposal. KERIpy's v2 Poster makes the same change (kentbull/keripy#157), and the default and candidate KERIpy peers are pinned to `v2-spec` `e16ae719`, which includes it.
