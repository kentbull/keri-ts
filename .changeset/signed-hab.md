---
"keri-ts": minor
---

Add `Habery.makeSignedHab(name, ns, { serder, sigers, hidden? })`, which adopts an inception the caller built and signed, with no Keeper key state for it (KERIpy `makeSignifyHab`). The inception and its signatures are verified before anything is persisted. Pair it with `Manager.hold` to sign with the host's key. `Hab.make` now shares its acceptance tail with the new path, with no change for `makeHab`.
