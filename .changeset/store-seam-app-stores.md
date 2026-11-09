---
"@keri-ts/wallet": patch
"@keri-ts/verifier": patch
---

Compose `WalletBaser` and `VerifierCueBaser` over an injected `DBer`, and remove the wallet's `node:buffer` dependency in favor of standard base64 helpers. Stored values and paths are unchanged.
