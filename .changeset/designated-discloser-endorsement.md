---
"keri-ts": patch
"@keri-ts/wallet": patch
"@keri-ts/tufa": patch
---

Remove the issuer-endorsement file workflow (`tufa ipex endorse` and `WalletDiscloser.endorseGrant`), matching KERIpy and Locksmith. Exact-file `--prepare`, `--proposal` and `--resume` remain for collecting group sender signatures, and core issuer-designation verification is unchanged.
