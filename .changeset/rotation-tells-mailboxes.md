---
"keri-ts": patch
---

Completing a rotation now tells the identifier's mailboxes. `completeEvent` posts the KEL (delegation chain, KEL and stored receipts) to every mailbox the identifier has an authorized role with once a `rot` or `drt` is fully witnessed, and its result gains `mailboxes`: one `{ mailbox, outcome: "told" }` or `{ mailbox, outcome: "failed", reason }` per mailbox. A mailbox that cannot be reached does not fail the rotation; the poller's repair on a 403 remains for it. The Counselor does the same when a group rotation completes, in each member runtime that has the group's mailbox role (the posts are idempotent). The post is one function, `postKelToMailbox`, shared with the poller's repair; `tellMailboxes` is exported from `keri-ts/runtime`. Interaction events publish nothing: they change no keys, which is what a mailbox checks.
