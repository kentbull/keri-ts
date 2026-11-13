---
"keri-ts": minor
"@keri-ts/tufa": minor
---

`tufa witness start` and `tufa mailbox start` accept `--version 1.0|2.0`, spelled and valued like `tufa incept --version`, for the host AID they create (default 2.0; an existing alias keeps its KEL version). A host created as KERI 1.0 now signs v1 `/loc/scheme` and `/end/role/add` replies, and the witness HTTP `/ksn` reply follows the witness AID's KEL version instead of always answering KERI 2.0, so a KERIpy v1 deployment accepts what the host publishes. `parseKeriVersionOption` is exported from `keri-ts/cli`.
