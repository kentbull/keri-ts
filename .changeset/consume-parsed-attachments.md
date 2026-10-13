---
"keri-ts": minor
---

Consume typed CESR attachment values directly in runtime envelopes instead of decoding their qb64 bytes again. Reuse hydrated Serders, retain role checks for caller-supplied frames, and project numeric/nonce descriptor views from existing primitive instances.

Remove the four runtime dispatch `fromQb64bTuple` factories that existed for the duplicate decoding path. Callers can construct validated primitives and use `fromTuple`; CESR structing raw-input factories remain available.
