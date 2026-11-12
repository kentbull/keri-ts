---
"keri-ts": minor
---

Add the delegation stage to `Counselor` in `keri-ts/runtime`. A delegated group inception or rotation waits for its delegator: the publishing member (elected, or any member after `fallbackAfterMs`) begins the existing Anchorer and the Counselor records completion; other members query the delegator's witness, pin the anchor seal and finish through witness receipts. Adds `supply`, a `proxy` input, the `proxy` and `delegatorUnknown` block kinds and the optional `GroupDelegation` constructor collaborator. `status` now reads `pending` for a counseled event whose body is not stored yet, `start` no longer retains inputs for a complete or superseded event, and `abandon` publishes one `<pre>:<sn>` change per removed event. The delegator-anchor query with backoff is now a shared function used by both the Anchorer and the Counselor, with unchanged Anchorer behaviour.
