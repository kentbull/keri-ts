---
"keri-ts": patch
"@keri-ts/wallet": patch
---

Move KERI domain, registry and wallet storage work onto the `DBer` contract with `transaction`, `flushed`, `writeVersion` and `refreshRead`, so domain code no longer touches the native LMDB environment. Behavior is unchanged.
