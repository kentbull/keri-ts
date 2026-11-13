---
"keri-ts": patch
"@keri-ts/tufa": patch
---

A wait on an issuance, presentation or Unblind (`waitForIssuance`, `waitForPresentation`, `waitForUnblinding`) no longer settles while the live operation still holds a message in its delivery outbox: `IssuanceOperations.owes`, `PresentationOperations.owes` and `UnblindingOperations.owes` report it. A group issuer member's `tufa ipex grant --issue --resume` therefore stays until its DH contribution has been handed to the transport, instead of exiting at the `awaitingAnchor` phase with the contribution still queued (the KERIpy custodian then never reached DH quorum and its operation expired). `tufa multisig join --kind <kind>` approves only a pending proposal of that kind (and refuses a `--said` of another kind), so a join never signs an unrelated pending proposal; without `--kind` it still approves the first pending one.
