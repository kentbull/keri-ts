---
"@keri-ts/wallet": patch
"keri-ts": patch
---

A group inception checks that every other member can be reached before it creates the group habitat, so a call that cannot be published leaves nothing behind and the alias can be used again (`proposeGroupInception`, and so the CLI; `Poster.canReach` is the pure read). The web wallet records a completed group issuance in its inventory for the custodian and for a member that consented through `proposals.approve`, through the same `ChangeSink` reaction as a single-signature issuance; the custodian's `issued` result carries `recorded`. The wallet's method signatures name their option and result types (`TimeoutOptions`, `ReceiveOptions`, `UnblindOptions`, `PresentWaitOptions`, `ProposalListOptions`, `GroupReceiveOptions`, `GroupIssueOptions`, `GroupUnblindOptions`, `GroupPresentInput`, and others) instead of inline object types. The wallet's namespaces (`identifiers`, `oobis`, `mailboxes`, `credentials`, `groups`, `proposals`) share one `WalletScope` they hold, instead of extending a base class; their classes are exported as types only.
