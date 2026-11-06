---
"@keri-ts/tufa": patch
---

The elected issuer-group custodian now sends the final `/multisig/ipex-proof`, with its public evidence, to the other issuer members by mailbox on topic `multisig`, as KERIpy does for its group proof. An issuer member's `tufa ipex setup --said GRANT` for its own group's Grant polls its mailbox and verifies the proof. `--proof-output` and `--proof FILE` are optional file fallbacks, and the custodian no longer requires `--proof-output`.
