---
"keri-ts": major
---

Use typed multisig proposal evidence and expose exact publication identities through explicit owners.

Group publication helpers now take explicit owners and return proposal identities
alongside deliveries. VCP/ISS construction requires route-specific named children;
initiation and approval share signing/delivery records without a runtime bundle.
Group CLI results expose each recipient wrapper SAID and the shared proposal index
key. Transport completion remains distinct from group acceptance. Callers using
internal publication helpers must consume the structured result instead of a URL
array; no legacy signature adapter is provided.
