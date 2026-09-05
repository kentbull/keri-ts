---
"keri-ts": patch
---

Close an unreturned Reger when opening fails or is cancelled, and await its cleanup before the factory settles. Successfully returned registries remain caller-owned.
