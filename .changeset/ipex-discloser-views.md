---
"keri-ts": minor
"@keri-ts/wallet": patch
---

Move the graph authorization, registry proof, unblinding, attribute reduction, presentation proof, Apply and Reply parts of `WalletDiscloser` into the `IpexDiscloser` core exported from `keri-ts/runtime`. `WalletDiscloser` keeps every public method and its behaviour; selection from issued and held credentials stays in the wallet for now.
