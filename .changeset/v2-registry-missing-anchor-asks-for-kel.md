---
"keri-ts": patch
---

A v2 registry event (`rip` or `bup`) held because its anchoring issuer KEL event is not accepted yet now makes the
recipient ask for that KEL. The event's first entry into the anchor escrow publishes one `logs` query cue for the
issuer, starting at the first sequence number the recipient lacks and naming the anchor's sequence number when a
source seal supplies it, so the existing query path fetches the KEL instead of waiting for the issuer to send it.
