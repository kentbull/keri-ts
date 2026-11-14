---
"keri-ts": patch
---

A TEL event escrowed because its anchoring issuer KEL event is not yet accepted now makes the recipient ask for
that KEL. Entering the anchorless escrow publishes one `logs` query cue for the issuer, starting at the first
sequence number the recipient lacks, so the existing query path fetches it instead of waiting for the issuer to send it.
