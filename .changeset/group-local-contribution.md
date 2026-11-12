---
"keri-ts": patch
---

Count other members' signatures on remotely received events for a joined group. `Kever.locallyContributedIndices` treated the group's own prefix as a local contributor, so every signature was stripped and the event was rejected. It now strips only the keys of the group's locally controlled members, as KERIpy strips its local member.
