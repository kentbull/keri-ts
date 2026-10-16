---
"keri-ts": minor
---

Remove serial whole-runtime and finite mailbox polling APIs. Commands and hosts use the same component workers, while mailbox retrieval retains endpoint concurrency, real I/O deadlines and cursor updates after consumer completion.
