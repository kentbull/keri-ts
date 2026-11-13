---
"keri-ts": patch
---

A group member the group completed a credential issuance without now accepts the Grant with no call from the host.
On its `ISSUANCE_SWEEP_MS` sweep of the pending exchange escrow the issuance owner begins the proof-only follow of
each pending group Grant, as issuer or holder, that the local member has no live, ended or complete operation for,
inside the Grant's deadline, once the custodian's `/multisig/ipex-proof` wrapper for that Grant is stored. The proof
exists only after the key exchange finished, so a member whose signature is still wanted is never followed in its
place. The follow signs nothing: it is no longer held back while the member cannot sign, and a restart begins it again
from the stored proof. A member holding a root copy or the proof reads `active` with phase `awaitingAnchor` instead of
`interrupted`. `followGroupIssuanceProof` stays for a proof supplied as bytes or a pinned coordinator and is now
idempotent: it returns the Grant when that member's follow is already live or its side is already complete. Consents
that add the member's signature, such as approving the group's Admit, stay explicit.
