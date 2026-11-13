---
"keri-ts": patch
---

A mailbox poller no longer repeats a refused query in a tight loop. When a provider answers the signed mailbox query with a non-success status (for example `403 Query requester is not authorized`, which a mailbox returns for an identifier whose rotation it has not seen), the endpoint worker now waits on the runtime clock before the next attempt: 1 s, doubling to at most 30 s per consecutive refusal, and starting over after an accepted poll (`MailboxPoller.RefusalBackoff`). A browser wallet that rotated its keys used to send about 80 refused requests a second until it closed. The shared clock wait of the issuance, presentation and Unblind owners is now one helper, `waitOnClock` in `app/runtime/workflow-contract.ts`.
