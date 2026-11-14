---
"keri-ts": patch
---

A group's issuance no longer sends the issuer's whole key event log twice to the holder. After proving, the custodian sends only what the Grant's proof support lacked: the anchoring event and the registry update. A custodian rebuilt after a restart did not send the first support and still sends it in full.
