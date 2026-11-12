---
"keri-ts": minor
"@keri-ts/wallet": patch
---

Add the `RegistryAuthor` core and `AcdcV2UpdateOptions` to `keri-ts/runtime`. It stages, anchors and advances ACDC v2 registry state over a `Regery`, `Receiptor` and optional `RegistryCustody`, and reads no credential inventory. `@keri-ts/wallet`'s `WalletAuthor` now extends it and keeps only `issue`, `stageRevocation` and `revoke`; its constructor, methods and behaviour are unchanged.
