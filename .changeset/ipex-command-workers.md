---
"keri-ts": minor
"@keri-ts/tufa": minor
---

Separate IPEX group coordination from CLI timing and worker ownership. Timed
completion and pending-proposal waits are private CLI orchestration.

Use the ordinary host workers for IPEX waits and report fully settled mailbox
batches/messages. Poll now uses `--timeout` seconds and join uses
`--approval-timeout` seconds instead of polling turn counts and per-turn budgets.
