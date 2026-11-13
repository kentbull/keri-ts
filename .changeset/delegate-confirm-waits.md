---
"keri-ts": minor
"@keri-ts/tufa": minor
---

`tufa delegate confirm` waits for the one thing it needs instead of a fixed 15 s window. `waitForPendingDelegation` observes the delegator's own `delegables.` escrow and `waitForDelegationAnchor` observes a group delegator's anchor until it is receipted; both live in `keri-ts/runtime`, take a caller-supplied `timeoutMs` and return a typed `settled` or `timed-out` outcome. The command gains `--timeout <seconds>` (default 30) for both waits, and its timeout errors now say which request or anchor never arrived. A test drives a group delegator's confirm path through these calls with a second member approving the proposal through `approveGroupProposal`.
