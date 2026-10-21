---
"keri-ts": minor
"@keri-ts/tufa": minor
---

Settle authenticated grant evidence in the local wallet before authoring admits by default. Admit and join commands keep one host alive through wallet/approval waits and delivery; group members independently check their wallet before a fresh admit contribution. Support bounded pending results, stable group approval resume and elected delivery to the accepted grant sender.

Grant files must pass valid EOF and ordinary exchange authentication before a response is signed. `--no-wait` now reaches the command handler and skips only the saved-credential requirement, reporting `saved: false` when appropriate. Admit results expose nullable `admit`, credential/saved facts, completed deliveries and optional group completion; Tufa formats these after cleanup. New `--timeout`, `--approval-timeout` and `--gvrsn` admit options select the existing finite waits and attachment context.
