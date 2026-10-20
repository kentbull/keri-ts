---
"keri-ts": patch
"@keri-ts/tufa": patch
---

Validate multisig command options and every configured member before opening stores. Reject malformed member/witness lists and supplied approval timeouts, retain fractional-second waits, and preserve rotation-file data when flags are omitted. Explicit empty data remains an override.
