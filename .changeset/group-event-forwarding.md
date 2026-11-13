---
"keri-ts": patch
---

The elected member of a group forwards a completed group event to every other signing member when the Counselor completes it, so a member that never saw the signatures that completed it converges. `Counselor` takes a narrow `GroupForwarding` port (the runtime supplies `groupEventForwarding`, which replays the accepted event through the Poster); each member's outcome is a `GroupDelivery` and a failed member is retried with a doubling delay, never thrown (`forwardOutcomes` reads them). A member that only receives a group rotation (naming the members the group already has) or a reply that the proposer's signatures already complete now takes it on receipt without approving, as it does an interaction or a registry anchor.
