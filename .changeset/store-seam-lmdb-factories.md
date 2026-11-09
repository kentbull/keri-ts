---
"keri-ts": patch
---

Move the LMDB-backed `create*` store factories into one module, so the store classes themselves no longer reach the native addon.
