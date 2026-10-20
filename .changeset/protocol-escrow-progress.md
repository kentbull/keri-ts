---
"keri-ts": patch
---

Return committed recovery progress from protocol escrow sweeps, including
dependency migration and retained proofs. Complete finite TSN scans before
reporting an unchanged sweep. Preserve pending TEL inceptions and retain evidence
when unexpected processing or storage failures propagate.
