---
"keri-ts": minor
"@keri-ts/tufa": minor
---

Remove automatic durable outbox enqueue/retry and queued delivery results. Mailbox sends attempt each target and report any failure, including partial delivery, to the caller.
