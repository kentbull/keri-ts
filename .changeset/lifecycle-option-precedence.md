---
"keri-ts": patch
"@keri-ts/tufa": patch
---

Validate inception and rotation options before opening stores. Preserve omitted flags through option-file merging, apply defaults afterward, and honor explicit false, zero and empty-list overrides. Reject malformed counts, thresholds and list entries instead of coercing or filtering them.
