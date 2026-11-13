---
"keri-ts": patch
"@keri-ts/wallet": patch
---

A member that holds only the mailbox-delivered proposal of a fresh group DH issuance can now consent to it from the wallet. `groupIpexProposals` no longer lists a fresh issuance Grant (a Grant whose origin its own group issues, disclosed without registry proof), so `proposals.approve` takes the issuance call instead of the group IPEX one, and the two lists agree. `proposals.approve` returns `{ outcome: "refused", reason }` for an IPEX or issuance proposal the library will not approve yet, instead of throwing. A group member that approved a registry update now records the issued credential: `RegistryCustody.issuedOpening` derives the opening of the update that issued it. A non-elected member whose witness receipt fetch answers with a reply it cannot parse submits at its next attempt instead of after the 60 s grace. "ACDC v2 group graph is false or unresolved" now names each node's verdict and reason, and `authenticateIpexNode` rejections carry a reason.
