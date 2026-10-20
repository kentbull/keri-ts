---
"keri-ts": major
"@keri-ts/tufa": major
---

Remove automatic consumption of locally stored mailbox messages by runtime hosts. MailboxPoller now retrieves messages only from mailbox endpoints over HTTP/SSE; MailboxPollBatch drops source and requires the provider eid. Use direct HTTP/TCP delivery or explicit protocol intake for immediate recipient processing. Provider storage, authorized forwarding, SSE serving and remote polling remain available.
