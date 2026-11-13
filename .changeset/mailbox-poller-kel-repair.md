---
"keri-ts": patch
---

A mailbox poller now repairs a mailbox that has fallen behind the wallet's key state. When a provider answers the signed mailbox query with 403 and the identifier's KEL is fully witnessed, the endpoint worker posts the KEL replay (delegation chain, KEL and stored receipts, `collectKelSubmission`, moved out of the mailbox admin module) to the provider's CESR ingress as its own request, polls again at once, and falls back to `RefusalBackoff` if that is refused too. A rotated wallet no longer has to call `addMailbox` again to keep receiving mail. A keri-ts mailbox host now also authorizes a poll for a group identifier signed by one of its members (the member's threshold is met and its key is in the group's current key list); before, every group poll was refused because the requester was the member, not the group.
