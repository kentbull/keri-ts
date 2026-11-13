---
"keri-ts": patch
---

An idle `runAgentRuntime` costs far less CPU. The postman and query-sender workers spun on a zero-delay timer and now run as fixed-tock doers that look only at their in-memory queues. `protocolPacing.tockMs` now also governs the escrow loop and those workers. The escrow loop, OOBI resolution, authentication, delegation and group counseling scan their store rows on tock 0, after this handle wrote the store (`Dber.writeActivity`, an in-process counter), when they hold work in memory, and every `idleTocks` tocks (`DoerPacing.idleTocks`, default 32) for work that only time releases. Doers wait for the next tock boundary, so loops with one tock wake the host together. A queued message waits at most one tock before delivery starts, and a row written by another process is seen within `idleTocks` tocks.
