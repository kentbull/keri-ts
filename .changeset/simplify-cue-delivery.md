---
"keri-ts": major
"@keri-ts/tufa": major
---

Yield raw wire from Hab.processCuesIter, rename ReplayCue.messages to msgs and runtime.poster to postman, and remove CueEmission and reply cursors. Respondant publishes complete local replay batches atomically. Poster delivers events FIFO, retains whole failed events with partial successful deliveries, and exposes explicit retry/discard instead of automatic exact-packet retries.
