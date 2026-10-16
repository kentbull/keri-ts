---
"keri-ts": minor
"@keri-ts/tufa": minor
---

Separate direct multisig approval from CLI scheduling. Timed waits and delegation
completion belong to CLI orchestration; direct proposal approval does not start
or drive background workers.

Run each multisig command under one joined host lifetime. Multisig join now uses
`--approval-timeout` in seconds instead of polling turn counts and per-turn budgets.
