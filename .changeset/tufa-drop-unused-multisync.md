---
"@keri-ts/tufa": patch
---

Stop mapping and depending on `@keri-ts/multisync` in the Tufa npm build. Tufa selects group newcomers through the core registry-root API since the ESSR root replication change, so the stale mapping made the npm build fail.
