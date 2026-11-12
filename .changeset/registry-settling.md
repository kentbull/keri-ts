---
"keri-ts": minor
---

Add `registryEventRef`, `registryEventStatus`, `settleRegistryEvent` and `waitForRegistryEvent` to `keri-ts/runtime`: one home for settling an ACDC v2 registry (`rip` or `bup`) event sealed by a group anchor. Status reads whether the anchor is accepted, receipted and the TEL event accepted; settle reprocesses the escrows without signing; the wait only observes and returns a `WaitResult`. `tufa multisig join` and `tufa acdc` registry approval call them with unchanged output, group TEL waits use the library `waitForTelEvent` and `waitForIssuedCredential`, and the CLI-only boolean TEL wait adapters are removed.
