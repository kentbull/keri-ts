---
"keri-ts": minor
"@keri-ts/wallet": patch
---

Add the `IpexDiscloser` core to `keri-ts/runtime` with `anchorIpexExchange`, `exchangeWire` and the `PreparedDisclosure`, `PreparedGrantBody` and `IssuanceGrantOptions` types. It holds the inventory-free half of ACDC v2 Grant preparation: fresh-issuance Grant bodies, public KEL and TEL proof support, exchange wires and source anchoring. `@keri-ts/wallet`'s `WalletDiscloser` now extends it and keeps presentation selection from issued and held views; its constructor, methods and behaviour are unchanged.
