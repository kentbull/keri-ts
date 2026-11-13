---
"keri-ts": patch
---

After `replaceGroupMember`, a group's mailbox poller now polls and signs as the new local member without reopening the runtime. Poll workers are keyed by the signing member as well as the subject and endpoint, so a replaced member's worker is halted and a new one starts, and a halted worker clears the signer condition it had reported (`mailbox-poller:<pre>/<eid>`) so a wallet's `health()` no longer stays `signer-unavailable`. `replaceGroupMember` also prompts the mailbox poller, the KEL publisher (an expired post budget keyed by the group is re-armed) and the root replicator (owed root copies are derived for the new sender), so each acts on its next tock instead of its next sweep.
