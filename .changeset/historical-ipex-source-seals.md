---
"keri-ts": patch
---

Preserve verified historical IPEX grant source seals after the anchorer rotates,
matching the pinned KERIpy main reference. Keep current-key freshness for
supplemental signatures and reject anchors that do not commit to the exact grant.
