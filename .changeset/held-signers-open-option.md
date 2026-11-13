---
"keri-ts": patch
"@keri-ts/wallet": patch
---

A host can supply held signers when it opens a Habery or a web wallet. `HaberyArgs.heldSigners` (type `HeldSigners`, a list of `Signer`s) is applied with `Manager.hold` as `openHabery` builds the Manager, before the Habery is returned, so the first mailbox poll of an identifier whose keys the host keeps (`makeSignedHab`) is signed; every opener built on `openHabery`, including `createHabery`, takes it, and `openWebWallet` forwards its own `heldSigners` option. Before, `openWebWallet` started its runtime before returning the wallet, leaving no moment for a host to hold a signer first. Held signers are still not stored: pass them at every open.
