---
"keri-ts": minor
"@keri-ts/tufa": minor
---

Treat a peer as KERI v1 until its own latest accepted event is v2. Delivery now fails with a typed `PeerVersionError` instead of sending v2 to a recipient, endpoint or mailbox provider that can only be treated as v1. A deliberate `--version 2.0` rotation can now upgrade a v1 identifier.
