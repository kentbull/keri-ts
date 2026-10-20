---
"keri-ts": major
"@keri-ts/tufa": major
---

Rename multisig send reporting to explicit message identities: `MultisigSendResult`, `MultisigMessageIdentity`, `SignedMultisigMessage`, `MultisigMessageDelivery`, `messages`, `exnSaid` and `payloadSaid`. Delivery reports completed transport destinations rather than participant approval; `join --said` continues selecting the outer coordination EXN.

Return typed credential issuance data instead of `CredentialCreateResult.output`. Affected KERI CLI helpers return results, while Tufa adapters own final JSON and identifier presentation. Preserve protocol bytes, signing order, routing and acceptance behavior.
