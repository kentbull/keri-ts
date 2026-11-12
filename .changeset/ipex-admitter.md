---
"keri-ts": minor
"@keri-ts/wallet": patch
---

Add `IpexAdmitter` and `PreparedAdmit` to `keri-ts/runtime`, holding Admit preparation and the accepted-exchange, origin and graph-acceptance checks it shares with wallet admission. Move `inspectGrantFile` with `GrantFileSelection` and `InspectedGrantFile` into the `IpexDiscloser` core. `Wallet` and `WalletDiscloser` keep their public methods, error messages and behaviour; `recordAdmission` and `heldCredential` stay in the wallet.
