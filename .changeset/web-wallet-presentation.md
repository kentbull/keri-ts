---
"@keri-ts/wallet": minor
"keri-ts": minor
---

The web wallet presents and verifies credentials. `wallet.credentials.present` signs an `offer`, `grant`, `apply` or `agree`/`spurn`, queues it and waits for delivery; `requestProof` is the verifier's `apply`; `presentations` lists the pending Grants addressed to the wallet other than issuance Grants awaiting consent; `unblind` consents to fetch the missing registry proofs and waits; `resendAdmit` delivers the stored Admit of an admitted Grant again; `mailboxes.remove` revokes a mailbox. Each waiting call returns a typed `outcome` (`delivered | ended | timed-out`, `unblinded | ended | timed-out`, `revoked | rejected | timed-out`).

keri-ts adds `OperationStores.views`, the embedder's credential inventory, so `runtime.operations.presentation` can present an issued or held credential (without it only replies and `apply` can be presented); `pendingPresentations(ops, { hab? })`, a pure read of the pending v2 Grants addressed to a local identifier; and `rebuildIssuanceAdmit(deps, admit)`, which rebuilds the wire of an Admit this process signed so it can be delivered again.
