---
"keri-ts": patch
---

`multisig join` now skips a proposal whose group event is already accepted locally and that names no local signing member, such as an earlier rotation that only committed to a newcomer's next key. Previously the newcomer's `--auto` join picked that stale proposal first and failed with "No local member key can sign this group event", so it never reached the rotation it was meant to sign.
