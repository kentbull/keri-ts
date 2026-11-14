---
"keri-ts": patch
---

An edge sending through a relay no longer re-introduces its whole KEL on every forwarded delivery: the relay is
introduced to again only when the KEL publisher has not recorded it as holding the sender's latest establishment
event. The second proof-support message of an individual issuance now carries only the anchoring event and the
registry update that proving added, not the whole support again.
