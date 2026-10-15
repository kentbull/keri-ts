---
"keri-ts": minor
---

Pass the actual cue source to sink admission and compose responder delivery in respondantCueSink at the runtime root. Replace Respondant.forHab callers with the root composition function. QueryCoordinator prepares pending queries without a parent runtime or Reactor callback scheduling; its processPending and queryDo methods take no runtime argument.
