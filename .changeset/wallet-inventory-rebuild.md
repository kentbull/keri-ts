---
"keri-ts": patch
"@keri-ts/wallet": patch
---

A wallet refilled from a co-member now rebuilds its inventory. `credentials.importStream(bytes, options?)` runs `importCredentialStream` against the wallet's own runtime and returns its `CredentialImportResult`, so an embedder never reaches into `wallet.runtime` to import. `credentials.rebuild()` then writes the inventory rows the imported history proves and returns the inventory: an `admitted.` row for every accepted Grant addressed to a local identifier (individual or group) whose accepted Admit answers it (`Wallet.reconcileAdmissions()`), checked against the history the pair was accepted under, so a credential revoked since is still listed as held; and an `issued.` row for every accepted Grant a local identifier sent of a credential it issued, once the wallet holds that registry's root. Both are explicit calls and idempotent. `Wallet.recordAdmission` is unchanged and still requires current standing; the new `AdmissionEvidence` type names the two checks.

`RejoinResult`'s `joined` outcome gains `written`: true when the call wrote the group record, false when it found the record already there. A written record means the identifier was already a member and the store had no record of the group, which is the embedder's signal to refill its credentials from a co-member. The wallet library guide gives the refill sequence and what it does and does not prove.
