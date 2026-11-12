---
"keri-ts": minor
---

Add `resumeIssuance` to `keri-ts/runtime` and `Dhke.resume` to the DH owner. After a process restart, a DH issuance whose key exchange already finished no longer reads `interrupted`: when the Grant is still pending inside its deadline and the registry has no accepted update, `issuanceStatus` reads active with `needs: "anchor"` (issuer) or `needs: "finish"` (holder), and `resumeIssuance` re-establishes the in-memory authorisation without a new key exchange so the registry update is anchored, the Grant finished and proof support sent. The Keeper now records which Grant's exchange retained each DH registry root (new `rrgrants.` sub-database), which is the durable evidence resume relies on. Nothing is signed after a restart until the user calls `resumeIssuance`. Refusal of a new Grant on a registry that already holds a root is unchanged in this release.
