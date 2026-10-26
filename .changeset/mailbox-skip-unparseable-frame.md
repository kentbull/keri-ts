---
"keri-ts": patch
---

Skip an unparseable frame returned by a mailbox poll instead of crashing the agent
runtime. `settleMailboxPollBatch` now catches a `ParserError` from
`reactor.processBytes`, logs it and continues, so the batch completes and the
provider cursor advances past the bad frame; non-parse errors still propagate. This
matches KERIpy's parser, which logs and continues on a malformed frame.
