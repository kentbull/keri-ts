---
"keri-ts": patch
---

Author habitat replies, queries and plain (embed-free) exchanges in the habitat's accepted KEL version, answer `ksn` queries in the query's own version and kind, and prefix a genus-version counter wherever an OOBI or KEL replay stream changes attachment genus, so KERIpy v2 peers no longer drop v1 replies that follow a v2 KEL. Encode v2 first-seen replay ordinals with KERIpy's compact automatic Number code instead of the fixed-width Huge code; v1 attachment streams keep the Seqner-width ordinal.
