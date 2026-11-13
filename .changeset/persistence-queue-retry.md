---
"keri-ts": patch
"@keri-ts/wallet": patch
---

Retry a failed browser persistence write before latching. `PersistenceQueue` retries a failed task in place on a short
fixed schedule (`PERSISTENCE_RETRY_DELAYS`, about half a second), holding the head of the queue so no later commit
overtakes it, and latches only when every attempt fails. A latched queue now reports `PersistenceLatchedError` (cause:
the original failure) from commits, `flushed()` and `close`. `queue.read(task)` runs a task in queue order and returns
its result; a throwing read rejects only its caller with `PersistenceReadError` and never latches. `queue.status()`
reports `healthy`, `retrying` or `latched` (`PersistenceStatus`). The web wallet exposes them as
`persistenceStatus()` and `readPersisted(task)`.
