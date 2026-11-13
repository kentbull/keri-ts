---
"keri-ts": patch
"@keri-ts/wallet": patch
---

Group workflows that send a wrapper to every other signing member no longer fail on the first member that cannot be reached, after the event is already accepted locally. `publishProposal`, `approveGroupProposal`, `publishAcdcV2Registry`, `proposeRegistryEvent`, the legacy registry and credential proposals and the group endpoint role deliver to each member independently and report `members` (`GroupDelivery`: `delivered` with its destinations, or `failed` with the transport's reason) in their result, so the Counselor always starts and a caller can send a failed wrapper again; `Poster.canReach` still refuses an inception up front. The wallet's group event outcomes and `proposeMailbox` carry `members`, and Tufa prints them. Group issuance no longer sends its traffic to a member held in the same Habery.
