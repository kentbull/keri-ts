---
"keri-ts": patch
"@keri-ts/wallet": patch
---

A real fault in a runtime loop now ends `runAgentRuntime` instead of being swallowed. The operation owners' loop, the KEL publisher loop and the Counselor's forwarding of completed group events caught every error: the owner loop counted it in `operations.health` and kept running, the publisher counted it in `publisher.health`, and the Counselor turned it into a `failed` forward to every member and retried it up to eight times. No remote, network or validation outcome reaches those places (a failed post, delivery or member forward is already a typed `failed` result below them), so what they caught was store errors and corrupt state; they now catch nothing. Halting the runtime is not a fault and stays clean.

A local group whose record names a member habitat the store does not hold now throws the new `MissingDurableStateError` (a `DatabaseError`) from `localGroupMember`, instead of a `ValidationError`; a prefix that is not a local group still throws `ValidationError`. A peer's Grant whose disclosed credential names a registry that is not a canonical SAID no longer throws out of the holder's resumable-Grant sweep and `pendingIssuanceGrants`: `Manager.hasRegistryRoot` answers `false` and `Manager.getRegistryRoot` `null` for a key that is not canonical, and only `putRegistryRoot` refuses one. The Unblind owner no longer reprocesses held queries for a habitat that cannot sign when the loop asks whether it has work, which could throw `SignerNotHeldError` out of the loop.

Breaking changes: `RuntimeOperations.health`, `OwnerHealth` and `OwnerFault` are removed, and so is `KelPublisher.health`. `localGroupMember` throws `MissingDurableStateError` for a group whose local member is missing. The web wallet's `health()` no longer reports `faulted`; a loop fault ends the runtime, which `health()` reports as `stopped` with the fault as `cause`.
