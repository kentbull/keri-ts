---
"keri-ts": minor
"@keri-ts/tufa": minor
---

Keep deferred `/registry/root` copies escrowed until they are retained or refused, matching the KERIpy v2 TEL dependency-escrow idiom: `RegistryRoot.TimeoutRRE` and `timeoutRRE` are removed, `Baser.rrpe` records when a copy entered escrow, and `PendingRootCopy.deadline` is replaced by `escrowed`. An identical resend of a stored copy that is neither escrowed nor retained is escrowed again instead of being ignored. `Habery` load now commits the members of a local group's latest accepted establishment event when an interrupted live commit left `smids`/`rmids` stale (`Habery.recoverAcceptedGroupMembers`, `acceptedGroupMembers`).
