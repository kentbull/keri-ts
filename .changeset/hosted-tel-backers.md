---
"keri-ts": minor
"@keri-ts/tufa": minor
---

Add optional legacy/v1-style TEL backing for credential events (`vcp`, `vrt`, `bis`, `brv`), producing indexed endorsements required by the registry's configured backer quorum. Native ACDC v2 registries (`rip`, `bup`, `upd`) do not use or require this mechanism. TEL backing is separate from issuer multisig approval and KEL witnessing. KERIpy supplies the receipt format and observer validation; the autonomous signing service is an additional implementation. The legacy/v1-style designation describes the registry event model independently of KERIpy release, message version, CESR attachment genus or keri-ts package version.

Add explicitly selected nontransferable TEL backer hosting with `tufa agent --backer-alias`. Persist each signer's endorsement before transmission, refuse conflicting coordinates across restart, and return ordinary receipt evidence through signed issuer controller/agent endpoints. Reject malformed backer thresholds before quorum checks or endorsement. Receipt production remains separate from quorum acceptance and adds no durable delivery retry guarantee.
