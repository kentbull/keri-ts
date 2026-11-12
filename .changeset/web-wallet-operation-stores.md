---
"@keri-ts/wallet": patch
---

`openWebWallet` now accepts `runtime.operationStores` and by default records blind-derivation coordinates in the wallet inventory's own `derived-updates.` table, so an issuance driven by the runtime's operation owners can be recorded with `Wallet.recordIssued` and a `RegistryCustody` over the same wallet. Before, the runtime kept the coordinates in process memory and `recordIssued` failed with "Exact derived update coordinates are unavailable". `WalletDerivedUpdates` is exported from the custody module.
