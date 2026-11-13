---
"keri-ts": minor
---

Make a group's mailbox work for each of its members. A KEL submission for a local group now also carries the KEL of the local member that signs for it, so a mailbox host can authenticate the member's polls, including after the group or the member rotates. A host accepts a poll for a group from a member only when its signatures meet its own current threshold and one of them verifies against a key that is at that index in the member's current key list and in the group's current key list, so listing a group key in an inception no longer grants access to the group's mailbox. `Poster` wraps a message sent as a group in a forwarding envelope signed by the local member, since one member's signature does not meet a group threshold above one. `createAgentRuntime` accepts `mailboxPolling` to override the poller's request and poll windows.
