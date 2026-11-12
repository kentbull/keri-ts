---
"keri-ts": minor
"@keri-ts/tufa": minor
---

Report registry root copies as typed results instead of CLI output lines. `RootCopyResult` (kin `sent`, `deferred`, `refused` or `failed`, with the group, registry, sender, recipient, exchange SAID and the error object itself) is produced by `RootReplicator.processOnce`, `replicateRootCopy`, and the new `replicateRootCopies` and `resealRootCopies`; `RootExamination` reports a rotation whose recipients could not be selected. `RootCopyReport`, `RootResealFailure` and `RootCopyRecovery` are deprecated, with identical shape and values: they are the CLI's `root_copy` JSON line (a `phase` discriminator, a hard-coded `tufa` command, the error flattened to text), which an embedded wallet should not receive from a library. `replicateRegistryRoots` and `resealRegistryRoots` are deprecated and still return them, now as a thin mapping over the typed path. The `tufa` commands that send and re-seal roots now run through `RootReplicator` with a `MemoryRootLedger` and map results to the same lines in `keri-ts/cli` (`rootCopyLine`, `rootResealLine`), so their output is unchanged.
