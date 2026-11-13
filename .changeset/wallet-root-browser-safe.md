---
"@keri-ts/wallet": minor
"@keri-ts/tufa": patch
---

The `@keri-ts/wallet` root is browser-safe: it carries a `browser` export condition and exports the inventory, authoring, custody and disclosure surface with `openWalletBaser(opener, identity)`. `createWalletBaser`, the LMDB-backed factory, moves to the new Node-only `@keri-ts/wallet/lmdb` entry; import it from there. `@keri-ts/wallet/web` exports everything the root does plus `openWebWallet`. The wallet boundary check and the browser bundle gate now cover the root and `./web`, and the gate rejects `./lmdb`.
