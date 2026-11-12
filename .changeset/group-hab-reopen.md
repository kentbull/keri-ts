---
"keri-ts": patch
---

Hold a local group habitat across a reopen even while its inception is unaccepted, as KERIpy `loadHabs` does, so it becomes usable (receipts, signing, endorsements) when the event is accepted without calling `joinGroupHab` again. Previously a witnessed group event resumed after a restart failed every receipt attempt with "not a valid local AID". A habitat that cannot sign yet, such as a keyless pre-signed one before its signer is held, no longer makes `Habery` open throw when its alias has config: the config is applied by `hab.reconfigure()` once the signer is held, and `Habery.deferredReconfigure` lists those prefixes. Adds `Hab.canSign()`.
