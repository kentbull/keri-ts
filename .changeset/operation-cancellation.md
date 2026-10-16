---
"keri-ts": patch
"@keri-ts/tufa": patch
---

Bind external input cancellation to the consuming operation so waiting protocol
turns and active HTTP response consumers stop and join cleanup. Separate dispatch
choices from input lifetime and check cancellation at input consumption boundaries.
