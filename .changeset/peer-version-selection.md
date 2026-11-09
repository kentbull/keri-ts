---
"keri-ts": minor
"@keri-ts/tufa": minor
---

Delivery now fails with a typed `PeerVersionError` instead of sending KERI v2 to a recipient, endpoint or mailbox provider whose own latest accepted event is v1. A deliberate `--version 2.0` rotation can now upgrade a v1 identifier.
