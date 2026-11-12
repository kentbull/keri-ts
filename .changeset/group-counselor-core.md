---
"keri-ts": minor
---

Add `Counselor` to `keri-ts/runtime`: group-event completion on KERIpy's `gpse`, `gpwe` and `cgms` rows for the signature and witness stages. It tracks an event across restarts, never signs, removes an escrow row by exact event instead of by prefix, judges witness receipts against the event's own witness set, and lets a non-elected member submit receipts after a configurable grace so an offline elected member cannot stall the group. Also adds `groupWitnesser` (KERIpy `_groupWitnesser`), `waitForGroupEvent`, and a `"group"` workflow change kind. Nothing calls the Counselor yet.
