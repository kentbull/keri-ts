---
"keri-ts": patch
---

Let `createHabery` take a `StoreOpener` or borrowed already-open `Baser` and `Keeper`, and create Habery-derived sidecars through that opener. Borrowed stores are never closed by the Habery. LMDB remains the default at the same paths.
