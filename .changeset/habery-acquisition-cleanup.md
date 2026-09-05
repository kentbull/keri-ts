---
"keri-ts": patch
---

Close Habery-owned stores when initialization fails, and close unreturned Baser,
Keeper and Outboxer handles when their acquisition is cancelled or rejected.
Preserve existing data and caller-provided configuration on failure.
