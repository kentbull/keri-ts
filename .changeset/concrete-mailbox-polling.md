---
"keri-ts": major
"@keri-ts/tufa": major
---

Remove the replaceable mailbox polling transport from MailboxPoller and runtime
composition. Supply the HTTP client and clock directly; polling owns its concrete
HTTP/SSE operation. Retire the exported transport types and adapter without aliases.
