---
"keri-ts": minor
---

Remove the generic cue-publication helper and callback-based QueryReply.admit. Concrete consumers
prepare/publish directly before removing source records; query correspondence
exposes its ordered data through peekAll/takeAll. Preserve failure retention,
paired replies and lazy replay without publication lifecycle callbacks.
