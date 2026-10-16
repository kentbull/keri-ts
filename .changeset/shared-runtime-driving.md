---
"keri-ts": minor
---

Run finite CLI convergence through the same concurrent component workers as hosts.
Use explicit elapsed deadlines instead of serial runtime turn counts, join workers
before returning, and suspend the supervisor while its children progress.
