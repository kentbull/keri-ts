---
"keri-ts": patch
---

Make `LMDBer` and `MemStore` meet one ADR-0015 contract, now checked by a shared suite. Behavior change in `LMDBer`: an empty dupsort value is rejected with `DatabaseKeyError` (LMDB silently dropped it when a second duplicate arrived) and `addVal` no longer accepts `null`; empty values stay valid on plain tables. A scan no longer writes into the caller's `ScanOptions` (a reused object made a later `scan` return empty rows), duplicate reads of an empty key report it absent instead of reading the table's first key, over-long scan `end` and `seekVal` bounds compare as bytes, and bad keys or dupsort values, `delVals` of an empty key and closed scans raise `DatabaseKeyError` or `DatabaseNotOpenError`.
