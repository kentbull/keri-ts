---
"@keri-ts/hosting": patch
"@keri-ts/registrar": patch
"@keri-ts/wallet": patch
"@keri-ts/verifier": patch
"@keri-ts/observer": patch
"@keri-ts/tufa": patch
---

Depend on keri-ts 2.0.1, which rejects credentials whose body does not match their SAID. These packages pin keri-ts to an exact version, so they must be republished for the fix to reach their installs.
