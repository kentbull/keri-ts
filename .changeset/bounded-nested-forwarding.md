---
"cesr-ts": minor
"keri-ts": minor
---

Expose borrowed nested-substream serialization and preserve v2 forwarding trees through exchange admission, atomic child-row replacement, escrow, durable reopen, and replay. Keep child signatures and original qualified ESSR evidence on their owning messages.
Child serialization uses one body-and-attachment boundary, preserving admitted deep trees under the parser's default enclosure limit instead of doubling their depth.
