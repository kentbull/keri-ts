---
"@keri-ts/wallet": major
"@keri-ts/tufa": major
---

Remove plaintext registry-custody import/export and operator rewrap APIs and commands. Keep local encrypted derivation with registry/controller/discloser bindings and require exact retained event coordinates for disclosure, including after reopen. Remove the IPEX disclosure-only bound-event option used by coordinate guessing; authoring bound-event selection remains supported.
