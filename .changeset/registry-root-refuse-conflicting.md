---
"keri-ts": patch
---

Refuse a `/registry/root` copy whose root differs from the root already retained for its holder and registry before awaiting verification evidence, matching KERIpy kentbull/keripy#172. Such a copy is now a `RootRefused` dropped from `rrpe` instead of a `RootUnverified` that stayed escrowed forever.
