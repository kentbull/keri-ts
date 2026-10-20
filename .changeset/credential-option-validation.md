---
"keri-ts": patch
"@keri-ts/tufa": patch
---

Validate credential, IPEX and verifier options before storage. Reject malformed
list members and coercible timeout values while preserving omitted defaults and
supported zero/fractional waits. Validate credential JSON sections before effects.
