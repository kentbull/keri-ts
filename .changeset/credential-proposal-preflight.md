---
"keri-ts": patch
"@keri-ts/tufa": patch
---

Validate group VCP/ISS business evidence before member approval or signing: bind issuer, registry, credential, source triple and exact anchor; leave missing registry/schema/predecessor evidence pending and refuse conflicting aliases before KEL mutation. Establishment-only group credential workflows now author rotation anchors, using participants' prepared next keys. Reuse read-only TEL validation without constructing processors or writing escrow for preflight.
