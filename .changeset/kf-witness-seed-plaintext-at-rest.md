---
"@keri-ts/tufa": patch
---

Store KF witness TOTP seeds as plaintext at rest and encrypt them only in transit. The hosted witness keeps the registration secret in its allocation record, and `tufa infra kf onboard` writes the seed to the 0600 `--credentials` file instead of ciphertext bound to the account's inception key, so credentialed rotations no longer need to re-encrypt the file. Records and files in the earlier encrypted form are decrypted with the key still held and rewritten once; an undecryptable file asks the operator to re-run onboarding.
