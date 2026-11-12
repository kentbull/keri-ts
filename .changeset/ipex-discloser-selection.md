---
"keri-ts": minor
"@keri-ts/wallet": patch
---

Move credential selection and the Offer and Grant preparation into the `IpexDiscloser` core exported from `keri-ts/runtime`, behind a new `CredentialViews` port (`issued`, `issuedRegistry`, `held`). `HeldCredential` and `DisclosureSelection` now come from `keri-ts/runtime` and stay exported from `@keri-ts/wallet`. `Wallet` implements `CredentialViews` over its inventory, and `WalletDiscloser` keeps its constructor, methods and behaviour.
