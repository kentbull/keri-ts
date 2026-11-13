---
"keri-ts": patch
---

The operation owners loop and the KEL publisher loop are fixed-tock doers (`doEvery`, `DoerPacing`): a pass, then a wait of one tock on the runtime clock, as a HIO `Doer` re-runs every `tock`. The owners run every `OWNER_TOCK_MS` (50 ms) and the publisher every `KEL_PUBLISHER_TOCK_MS` (250 ms); the root replicator's rotation check and the publisher's walk of every identifier are sweeps on tock 0 and every `sweepTocks` (a minute), and only prompted identifiers are re-derived on the tocks between. `OwnerWake`, `operations.wake`, the `wake` deps, `KelPublisher.wake`, `KelPublisher.pending` and the busy and idle cadences are deleted (none shipped in a release). `ownerPacing` and `publisherPacing` runtime options let a host slow the tocks. The library's `addMailbox` and `completeGroupMailbox` prompt the publisher (`MailboxAdminDeps.publisher`), `KelPublisher.statusOf(pre)` reads one identifier, and `RootReplicator` gains `sweep` and `processDue`.
