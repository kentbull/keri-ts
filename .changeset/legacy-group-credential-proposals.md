---
"keri-ts": minor
---

Add `proposeCredentialRegistry`, `proposeCredentialIssue` and `proposeCredentialRevocation` to the library (`app/multisig/proposing.ts`). Each proposes a legacy group registry inception, issuance or revocation (`vcp`, `iss`, `rev`) through the existing credential workflows, hands the group anchor to the Counselor and returns without waiting; the group result now carries that anchor as `group.event`. `tufa vc registry incept`, `vc create` and `vc revoke` call them for a group issuer instead of the single-signature-or-group dispatch, with the same printed output and `fallbackAfterMs: 0` so every member still submits receipts. Backward compatibility with 2.1.0 is not a goal for 2.2.0.
