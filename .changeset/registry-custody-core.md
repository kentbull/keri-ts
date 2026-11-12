---
"keri-ts": minor
"@keri-ts/wallet": patch
---

Add the `RegistryCustody` core to `keri-ts/runtime` with the `DerivedUpdateStore` and `DerivedUpdate` types. It derives registry blinds from the Keeper root and keeps only non-secret derived-update coordinates in a store the embedder supplies. `@keri-ts/wallet`'s `RegistryCustody` now extends it and supplies the `derived-updates.` table as that store; its constructor, methods and behaviour are unchanged.
