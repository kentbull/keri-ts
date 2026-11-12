---
"keri-ts": minor
---

Add `RootReplicator` to `keri-ts/runtime`: registry root replication as a runtime reaction instead of a CLI step. A Dhke completion cue (`DhkeReplicate`, queued on the new `Dhke.replicated` deck, mirroring KERIpy's `replicate` cue) and a scan of each local group's latest accepted rotation owe sealed copies to the other current signing members, or to new and rekeyed members after a rotation, in a `RootLedger` the embedder provides (`MemoryRootLedger` is the in-memory one). `processOnce` sends what is owed, keeps a copy whose evidence or delivery is missing for the next pass, and drops one that can never be authorized. `replicateRootCopy` is the single-copy send shared with `replicateRegistryRoots`. Nothing calls the replicator yet.
