---
"keri-ts": patch
---

`Habery.joinGroupHab` now replaces a group habitat's recorded local member when that member is no longer a signing or rotation member of the group's accepted key state, and still refuses while it is. It creates no event. A rejoin also keeps the record's `sid` and `watchers`.
