---
"keri-ts": patch
---

A holder group member that contributes nothing to the key exchange can now accept the group's Grant.
`followGroupIssuanceProof` served only an issuer group; it now also follows a holder group's final proof, signing
nothing. A signing member of weight 0, such as a custodian whose signature never counts toward the threshold, could
otherwise never accept a Grant the group completed without it: its late consent is refused once the registry update is
accepted. Delivery was already unaffected by weight: such a member receives the issuer's Grant, the co-member's
exchange wrappers and the registry root copy like any other signing member.
