---
"keri-ts": patch
---

Skip an unparseable frame returned by a mailbox poll instead of crashing the agent
runtime. `settleMailboxPollBatch` now catches a `WireParseError` (malformed wire input) from
`reactor.processBytes`, logs it and continues, so the batch completes and the
provider cursor advances past the bad frame. A dispatch-side `ParserError` from a valid
frame (e.g. corrupt stored state) and every non-parse error still propagate. This
matches KERIpy's parser, which logs and continues on a malformed frame.
