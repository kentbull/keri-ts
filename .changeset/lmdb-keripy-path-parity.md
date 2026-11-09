---
"keri-ts": patch
---

Match KERIpy and hio on LMDB and config paths. After a fallback to the home directory, a reopen stays at the same alternate path. Restricted mode applies to the store directory only and is re-applied on open, and new `data.mdb` and `lock.mdb` files are owner-only. Config files live at `keri/cf/{base}/{name}.json`, and `Configer`'s default base is `main`.
