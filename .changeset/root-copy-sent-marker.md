---
"keri-ts": minor
---

Root replication no longer uses a process-local ledger. `RootReplicator` derives the owed `/registry/root` copies from state (held roots, current signing members) and records each copy the Poster reports sent in a new Baser sub-database, `rrsn.`, keyed (group, registry, recipient) and holding the public key the recipient contributed to the group when the copy was sealed to it and the send time (never a root). A new or rekeyed member is therefore re-sealed once after an accepted rotation, and a restart or second process neither loses nor repeats a copy. The first pass on a store from before `rrsn.` sends one copy per other member per held registry once. `RootLedger`, `MemoryRootLedger`, `OperationStores.rootLedger` and `OperationStores.rootReplication` are removed; `RootReplicator` gains `prompt` and `send`, and `scan`, `examine` and `owe` are gone. KERIpy ignores `rrsn.`.
