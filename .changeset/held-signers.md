---
"keri-ts": minor
---

Add `Manager.hold(signers)` and `Manager.release(pubs?)`. A host can borrow live signers that `sign`, `decrypt` and `open` consult before stored keys, without any Keeper table ever receiving the key or its seed. Held signers are unaffected by AEID changes and do not survive a reopen. The host owns the signers and their zeroing.
