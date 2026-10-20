---
"keri-ts": major
"tufa": minor
---

Simplify finite credential import to dispatch each frame once and let protocol
escrows recover local dependencies. Replace the public target/status taxonomy
with saved, complete and unaccepted results; accepted state determines completion.
Remove escrow progress tracking and bound ordinary recovery sweeps with the post-EOF deadline
exposed through tufa vc import --settlement-timeout-ms, defaulting to 5000 milliseconds.
