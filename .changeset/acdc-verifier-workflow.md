---
"keri-ts": patch
"@keri-ts/tufa": patch
---

Persist verifier revocation acknowledgements separately from issuance
acknowledgements and rescan saved TEL state so `tufa verifier run --once`
emits revocation webhooks correctly after credential imports in prior CLI
processes.
