---
"@keri-ts/wallet": patch
"keri-ts": patch
---

`openWebWallet` takes an optional `salt`, the qb64 of a 128-bit keeper root salt, so a fresh store opened with the same passcode and salt derives the same signator and salty identifiers again. A malformed salt rejects with `ValidationError` before any store opens, and a salt that differs from the root salt the store already holds rejects with the new `KeeperSaltMismatchError` after the wallet closed what it opened. The wallet guide says what the passcode and salt re-derive and what they do not.

Breaking change: the `HaberyArgs.tier` field is removed. `openHabery` never read it; the Keeper's tier is set through `Manager`.
