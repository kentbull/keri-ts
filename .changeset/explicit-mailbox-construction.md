---
"keri-ts": minor
"@keri-ts/tufa": minor
---

Remove AgentMode metadata and mode configuration. Hosts explicitly construct
provider mailbox storage with enableMailboxStore or borrow an injected Mailboxer;
ordinary command runtimes omit it. Use the same concrete components in every host.
