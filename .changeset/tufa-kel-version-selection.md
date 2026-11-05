---
"keri-ts": patch
"@keri-ts/tufa": patch
---

Add KLI-style `--version` (1.0 or 2.0, default 2.0) to Tufa inception, rotation, interaction and multisig commands so identifiers can author v1 KELs for v1-only peers. Rotation and interaction keep the accepted KEL version and refuse a conflicting selection.
