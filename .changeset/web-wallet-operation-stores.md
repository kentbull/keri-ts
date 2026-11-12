---
"@keri-ts/wallet": patch
---

`openWebWallet` now accepts `runtime.operationStores` and by default records blind-derivation coordinates in the wallet inventory's own `derived-updates.` table, so an issuance driven by the runtime's operation owners can be recorded with `Wallet.recordIssued` and a `RegistryCustody` over the same wallet. Before, the runtime kept the coordinates in process memory and `recordIssued` failed with "Exact derived update coordinates are unavailable". `WalletDerivedUpdates` is exported from the custody module.

`openWebWallet` also installs `WALLET_KRAM_CACHES` (exported) when the host passes no `runtime.kram`: 5 minute clock drift and 24 hour acceptance and pruning windows, so a wallet that was offline for hours can drain its mailbox. A host can still pass its own `runtime.kram`.
