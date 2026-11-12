---
"keri-ts": minor
---

With `ipexOwners: "per-identifier"`, `createAgentRuntime` now composes the operations owners and `runAgentRuntime` drives them. `runtime.operations` exposes `IssuanceOperations`, `PresentationOperations` and `UnblindingOperations` over in-memory stores, or the stores passed in the additive `operationStores` option, and `runtime.rootReplicator` replicates registry root copies owed by Dhke completions and accepted group rotations. Each owner's `processOnce` runs in its own fiber, so one stuck delivery does not stall the others. A DH owner now exists for every local identifier before traffic, including identifiers created or joined later, so a first DH query is no longer dropped as unowned. `operationStores.rootReplication: "off"` leaves root copies to the commands that send them.
