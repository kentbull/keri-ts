---
"keri-ts": patch
---

`validateSchema` keeps the compiled validator of a fully resolved schema closure in memory, per store and keyed by the verified root SAID (at most 256 per store, oldest evicted), so a Grant that waits in escrow no longer recompiles its schemas on every retry. A missing or invalid result is never kept, an override schema object is never cached, and a store that does not hold a schema still reports it missing.
