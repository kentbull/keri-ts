---
"@keri-ts/wallet": minor
---

Add the `@keri-ts/wallet/web` entry, a browser-safe wallet surface with a `browser` export condition. It exports everything the root exports except the LMDB-bound `createWalletBaser`, plus `openWalletBaser(opener, identity)`, which opens the wallet inventory store through any `StoreOpener` (for example `hby.opener`, so it shares the composition's one IndexedDB queue). The root `@keri-ts/wallet` is unchanged and remains Node-only.
