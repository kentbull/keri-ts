---
"@keri-ts/wallet": patch
---

`credentials.issue` takes an optional `registry`. A DH exchange derives a registry's root with the recipient and the registry takes it once, so a registry carries one credential; without `registry` the wallet now incepts a fresh one for each issuance instead of reusing a fixed name that a second issuance would fail on.
