---
"keri-ts": minor
---

Make a group's mailbox work for each of its members. A KEL submission for a local group now also carries the KEL of the local member that signs for it, so a mailbox host can authenticate the member's polls, including after the group or the member rotates. A host accepts a poll for a group from a member whose own current threshold is met and whose KEL shows it controlled one of the group's current keys, so a member that rotated ahead of the group is no longer locked out. `Poster` wraps a message sent as a group in a forwarding envelope signed by the local member, since one member's signature does not meet a group threshold above one. `createAgentRuntime` accepts `mailboxPolling` to override the poller's request and poll windows.
