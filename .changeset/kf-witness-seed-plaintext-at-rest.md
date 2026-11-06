---
"@keri-ts/tufa": patch
---

Store KF witness TOTP seeds as plaintext at rest on the controller and encrypt them only in transit. `tufa infra kf onboard` writes the seed to the 0600 `--credentials` file instead of ciphertext bound to the account's inception key, so credentialed rotations no longer need to re-encrypt the file.
