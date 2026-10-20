---
"@keri-ts/tufa": major
"keri-ts": major
---

Use ordinary Baser ownership for OOBI cleanup and report completion only after shutdown.

Remove `openOobiStore`, its options/store interface and the special existing-path
selector. Use ordinary Baser ownership and `Baser.oobis` with the canonical `>`
separator. Preview does not delete selected rows, but normal writable startup can
initialize tables and reload/clean habitat records. A missing database still
fails, although normal path preparation may create empty directories. CLI JSON
now reports complete/failed status after closure and preserves actual deletion
counts when shutdown fails. Generic LMDBer `openExisting` remains non-creating.
