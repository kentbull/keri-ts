---
"keri-ts": patch
"@keri-ts/hosting": patch
"@keri-ts/tufa": patch
---

Retain the first authenticated, scoped DH or Unblind query in its actual owner until explicit consent, bounded by the original query and Grant lifetimes. Restore ordinary KRAM replay rejection and acknowledge unhandled custom-query transport without consuming its cache.
