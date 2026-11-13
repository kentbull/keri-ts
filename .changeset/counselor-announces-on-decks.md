---
"keri-ts": patch
---

The Counselor announces what it learns on decks instead of through a callback. A completed group rotation (`rot` or `drt`) goes on the deck passed as its `rotated` argument (the runtime passes `KelPublisher.rotated`). A group whose establishment event completed, or whose stored members were aligned late, goes on its new `groupChanges` deck. The runtime gives that deck to its root replicator (`RootReplicatorDeps.changed`), and the replicator's next pass re-derives the group's owed registry root copies and retries its backed-off copies at once. Before this, a member list aligned late was only picked up by the replicator's sweep, up to a minute later. The sweep stays as the backstop. `GroupReceipting.receipt` options gain `allowTcp`, which the Counselor sets, so the runtime passes its `Receiptor` directly.

Breaking change: the Counselor's `GroupMailboxes` argument (`{ rotated(cue) }`) is replaced by `rotated?: Deck<RotatedCue>` and `groupChanges?: Deck<string>`.
