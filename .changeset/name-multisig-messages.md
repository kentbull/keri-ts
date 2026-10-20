---
"keri-ts": major
"@keri-ts/tufa": major
---

Rename multisig send reporting to explicit message identities: `GroupSendResult`, `GroupMessageRef`, `messages`, `exnSaid` and `payloadSaid`. Delivery reports completed transport destinations rather than participant approval; `join --said` continues selecting the outer coordination EXN.

Return one `RegistryResult` or `IssueResult` per credential operation, with optional group coordination facts, instead of `CredentialCreateResult.output`. Keep signed-message and per-message delivery helpers internal to the application module. Affected KERI CLI helpers return results, while Tufa adapters own final JSON and identifier presentation. Preserve protocol bytes, signing order, routing and acceptance behavior.
