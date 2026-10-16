---
"cesr-ts": patch
"keri-ts": patch
---

Preserve canonical partial attribute, edge and rule commitments when rebuilding
compactable ACDC credentials. Compute the credential commitment separately so
serialization does not silently rewrite negotiated disclosure evidence.
