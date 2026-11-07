---
"keri-ts": patch
---

Reject credentials whose body does not match their SAID in `Verifier.processCredential`. Parsed ACDCs are hydrated without verification, so an altered body under its original SAID was previously saved and indexed.
