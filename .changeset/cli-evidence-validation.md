---
"keri-ts": patch
"@keri-ts/tufa": patch
---

Validate endpoint, signing, query, DID and witness command options before opening stores. Reject malformed option types and mixed-type repeated lists instead of casting or discarding values. Resolver ports must be decimal integers in the supported range; explicit empty query anchor paths fail instead of silently selecting a different query.
