---
"keri-ts": patch
"@keri-ts/tufa": patch
---

Separate synchronous nested multisig body construction from byte parsing and wire preparation. Reuse parsed child frames without payload reads; retain bounded cancellable preparation and existing v1/v2 wire behavior.
