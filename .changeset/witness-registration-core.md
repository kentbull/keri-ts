---
"keri-ts": minor
"@keri-ts/tufa": minor
---

Add `Hab.decrypt` (KERIpy `BaseHab.decrypt`, defaulting to current keys) and core `registerWithWitness`, which registers a controller with a witness the way Locksmith does: the full KEL and any delegation chain as multipart text fields, the returned TOTP secret decrypted with the current keys and returned without persistence. `tufa infra kf onboard` now registers through it, so an account that rotated and lost a credentials row re-registers instead of failing. The hosted witness decrypts its stored code with `Hab.decrypt`.
