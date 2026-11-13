---
"keri-ts": patch
"@keri-ts/wallet": patch
---

One Habery can now run both sides of one issuance Grant, as a host with two tenants needs: a member of the issuing group and a member of the receiving group, or an issuer and a holder. The issuance owner keys its live and ended operations by the Grant and the party (`partyKey`, `liveOf`, `endedOf`); `issuanceStatus`, `waitForIssuance` and `abandonIssuance` take an optional `IssuanceParty` (`{ role }`), and a Habery that holds both answers for the issuer and says so in the status `role`. A side of a Grant is finished (`partyComplete`) when its own exchange has retained its root, not when the shared Grant is accepted. An outbox message for a recipient held in the same Habery goes through the reactor in process, and a local group's members that are not held there are still delivered to. The DH and Unblind query receiver hands a query to every local party of the transaction, and a holder in the issuer's Habery finishes against the Grant the issuer already accepted. Unblind has the same one-operation-per-Grant keying and is not yet changed.
