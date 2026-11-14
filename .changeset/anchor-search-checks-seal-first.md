---
"keri-ts": patch
---

Registry anchor search now tests each issuer event for the registry seal before checking its witness receipts, so one anchor check no longer costs quadratic time in the length of the issuer's key event log.
