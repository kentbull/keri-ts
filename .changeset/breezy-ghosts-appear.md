---
"keri-ts": major
---

Separate send-only messenger construction from HTTP query response ownership. Bind transport endpoints explicitly and use sendSource for ordinary message iteration; no old constructor or query-method compatibility shims remain.
