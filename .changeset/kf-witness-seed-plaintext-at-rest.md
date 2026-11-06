---
"@keri-ts/tufa": patch
---

Store KF witness TOTP seeds as plaintext at rest and encrypt them only in transit. The hosted witness keeps the registration secret in its allocation record, and `tufa infra kf onboard` writes the seed to the 0600 `--credentials` file instead of ciphertext bound to the account's inception key, so credentialed rotations no longer need to re-encrypt the file. A credentials file in the retired encrypted format is rejected with an error asking the operator to re-run onboarding.
