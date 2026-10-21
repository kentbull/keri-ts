---
"keri-ts": minor
"@keri-ts/tufa": minor
---

Complete group NoBackers credential revocation through `/multisig/rev` approval and member fanout. Reuse the original REV/anchor across restart, validate credential/registry/issuance authority before signing, and deliver completed evidence from the elected historical anchor signer.

Breaking: `revokeCredential` now takes Regery, Reactor, Poster and selection options; explicit recipient delivery uses `deliverCredentialRevocation` after publication. `vcRevokeCommand` returns typed data for Tufa to render after closure. CLI JSON distinguishes accepted REV, completed publication, member deliveries and business deliveries; pending revocation does not write a completed export.
