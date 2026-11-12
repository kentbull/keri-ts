---
"keri-ts": minor
"@keri-ts/wallet": patch
"@keri-ts/verifier": patch
---

Add a Grant walk policy, `grantWalk: "open" | "closed"`, to `loadIpexHandlers` and `AgentRuntimeOptions`. The default is `"open"`, matching KERIpy. Under `"open"` a far node the Grant does not carry is a permanent unknown: an OR group with a valid sibling accepts, and an AND group or a sole Edge refuses at once without escrow. `"closed"` refuses any Grant that omits a far node, as every Grant did before. A node the disclosure plan selects but the Grant does not nest refuses under both. `walkAcdcGraph` and `walkIpexGraph` now take the policy instead of a boolean, `AcdcGraph` carries it into `evaluateChain`, and `ipexGrantWalk(exchanger)` returns the configured policy. Wallet admission, disclosure and fresh issuance, ACDC v2 group approval and the verifier's current check now walk under the exchanger's policy, so they accept the same Grants the handler admits.
