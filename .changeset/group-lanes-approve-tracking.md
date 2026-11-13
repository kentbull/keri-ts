---
"@keri-ts/wallet": patch
---

`proposals.approve` for a group issuance Grant now tracks the inventory recording on every call until the credential is recorded. A member that reloaded after its consent, or whose issuance finished while the wallet was closed, previously never recorded the credential. Also adds two local-only browser lanes (group wallet, KERIpy member) that are written but not yet run.
