---
"cesr-ts": minor
"keri-ts": minor
"@keri-ts/tufa": minor
---

Reject malformed attachment wrapper tails consistently. Replace the dispatch entrypoints with parseAttachmentGroup, remove parser recovery options and parser-related --compat flags, and migrate runtime callers. Opaque wire families and KERIpy filesystem compatibility remain supported.
