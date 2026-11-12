---
"keri-ts": minor
"@keri-ts/tufa": patch
---

Add runtime-owned single-signature DH issuance to `keri-ts/runtime`: `IssuanceOperations` (an operations table driven by `processOnce`), `beginIssuance`, `prepareIssuanceGrant`, `issuanceStatus`, `waitForIssuance`, `abandonIssuance`, the `IssuanceOperationStore` port with `MemoryIssuanceOperationStore`, `posterDelivery`, `MemoryDerivedUpdateStore`, and an `"issuance"` workflow change kind. The user's one `beginIssuance` call authorises the whole issuer workflow, including the later KEL signature that anchors the registry update, only while it lives in memory; after a restart the operation reads `interrupted` and nothing is signed. The Grant's exchange deadline bounds everything and reads `expired`. `tufa ipex --issue` now calls the library and keeps its flags, output, errors and wire behaviour; it records wallet inventory itself after completion.
