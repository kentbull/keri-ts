---
"@keri-ts/tufa": patch
---

`tufa infra kf onboard` no longer requires an encrypted (AEID) Keeper: witness TOTP seeds are kept as plaintext in the 0600 credentials file, as Locksmith does, so the gate protected nothing. Credentials rows are validated as plaintext only, and the `--witness-credentials` help text describes the plaintext file.
