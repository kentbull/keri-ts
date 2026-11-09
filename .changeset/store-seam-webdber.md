---
"keri-ts": patch
---

Add `WebDBer`, an in-memory `DBer` mirror that writes each commit behind to a pluggable `Persistence` adapter, with `PersistenceQueue` keeping one commit order across the stores of a composition and `WebStoreOpener` binding them to it. All are exported from `keri-ts/db`.
