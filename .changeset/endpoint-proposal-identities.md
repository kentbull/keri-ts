---
"keri-ts": minor
"@keri-ts/tufa": minor
---

Endpoint-role proposal results and CLI JSON now return `proposals: [{ recipient, said }]` identifying actual signed exchanges, replacing the misleading single `said` and `attachmentBytes` fields. Register each recipient-specific proposal before delivery and preserve separate durable retry routing.
