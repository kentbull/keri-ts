---
"@keri-ts/wallet": minor
"keri-ts": minor
---

`openWebWallet` returns a wallet-level API so an app never builds workflow dependencies or calls `run(...)`. `wallet.identifiers.incept`, `rotate` and `complete` author an event and complete it (witness receipts, and the delegator's approval for a delegated event); `wallet.oobis.resolve` queues an OOBI and waits; `wallet.mailboxes.add` authorizes a mailbox; `wallet.credentials.pending` lists the Grants awaiting consent, `receive` consents, waits, admits, records the admission and delivers the Admit in one call, and `issue` incepts the registry if needed, creates the credential, gives the issuing consent, waits and records the issuance. Every call that waits has a `timeoutMs` default and returns a typed `outcome` (for example `complete` | `incomplete` | `timed-out`) with the status read at return; only caller-contract and infrastructure failures reject. An issuance that finishes after its `issue` call timed out is recorded in the inventory by the wallet.

`WebWallet.health()` now also reports `faulted` (the operations owners recorded a fault outside any single operation), `stopped` (the runtime ended without `close()`, with its cause) and `closed`; a call on a stopped or closed wallet rejects with `WalletStoppedError`. Presentation is not part of this API yet. The 2.1.0 `WebWalletHealth` has two more arms, so an exhaustive `switch` needs them.

keri-ts adds `pendingIssuanceGrants(ops, { hab? })` and `PendingGrant`, a pure read of the Grants a holder may consent to; `issuanceStatus` throws for a Grant until it is stored. The error for a DH issuance on a registry that holds a custody root now says a DH-issued registry must not have a custody root.
