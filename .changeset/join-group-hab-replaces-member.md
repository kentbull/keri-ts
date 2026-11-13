---
"keri-ts": patch
"@keri-ts/wallet": patch
---

`Habery.joinGroupHab` now replaces a group habitat's recorded local member when the group has accepted key state, the recorded member is in neither its signing nor rotation members, and the new member is in one of them. It refuses otherwise, including while the group has no accepted state. It creates no event, drops the root-copy rows addressed to the old member, and a rejoin keeps the record's `sid` and `watchers`. `replaceGroupMember(runtime, input)` (wallet: `groups.replaceMember`) does the same and ends the live issuance and Unblind operations bound to the old member with a reason.
