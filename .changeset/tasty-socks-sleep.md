---
"keri-ts": major
---

Persist ESSR evidence in KERIpy-shaped LMDB rows, preserving repeated fragments. Remove the payload archive, durable plaintext APIs and archive ownership machinery; getEssrs is now synchronous.

Use synchronous `Baser.getEssrs(said)` for ordered qualified evidence; plaintext consumers retain their own ordinary data instead of calling Baser persistence methods. See `docs/reference/compatibility/MIGRATING_TO_2_0.md` for the removed APIs and storage boundary.
