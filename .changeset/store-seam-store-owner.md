---
"keri-ts": patch
---

Add `StoreOwner`, `StoreOpener` and `LmdbStoreOpener` so domain stores can compose over an injected `DBer`, with `lmdbDefaultsFor` reproducing each family's existing LMDB paths. No owner uses them yet.
