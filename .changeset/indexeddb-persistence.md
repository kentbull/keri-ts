---
"keri-ts": patch
---

Add `IndexedDbPersistence`, the IndexedDB adapter behind `WebDBer`. It is not exported from a package entrypoint yet. Each store identity gets one database holding every logical table in a single object store, so adding a table never needs a schema version change that another tab could block. Each commit is one strict-durability transaction that settles only when IndexedDB reports it complete. A `versionchange` from another tab closes the connection and makes the next write fail, and a `clear` that another connection blocks rejects instead of hanging.
