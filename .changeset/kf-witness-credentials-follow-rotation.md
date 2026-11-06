---
"@keri-ts/tufa": patch
---

Re-encrypt retained KF witness credentials to the account's next signing key before a credentialed rotation. Keeper rotation erases the previous lot's private keys, so credentials left on the inception key could not be decrypted after the account's second rotation, and later `tufa rotate --witness-credentials` calls failed with a missing private key.
