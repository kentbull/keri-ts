---
"@keri-ts/wallet": patch
---

`openWebWallet` gets its single-writer store lock from `indexedDbOpener()` instead of taking it itself. The guarantees are unchanged: the lock is held before any store loads, released after the last store closes, and a second open of the same wallet is refused while the first is open.
