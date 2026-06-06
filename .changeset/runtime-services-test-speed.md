---
"keri-ts": patch
---

Add injectable runtime clock, HTTP, and mailbox polling seams so runtime tests
can exercise protocol behavior without repeated real sockets and sleeps. Convert
mailbox poller, mailbox admin, and witness runtime coverage to cheaper
fixtures while preserving representative live transport tests.
