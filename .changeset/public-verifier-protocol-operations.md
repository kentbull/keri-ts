---
"keri-ts": patch
---

Expose the existing credentialSaidFromGrant, storedGrantArtifacts and IPEX_GRANT_ROUTE through keri-ts/runtime for application consumers. Expose the existing strict parseGvrsn through keri-ts/cli. Protocol behavior is unchanged; the verifier application can use public package boundaries without private sibling imports.
