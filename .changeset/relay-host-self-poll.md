---
"keri-ts": patch
---

A host that co-hosts a member of a group and is the group's `mailbox` or `agent` now processes a third party's message to the group exactly once. Before, the `/fwd` intake ingested the message for the co-member and stored one copy for the group's remote members, and then the host's own `MailboxPoller` polled the group's mailbox at itself and processed every stored copy a second time.

One mechanism now delivers a local group's mail locally in every configuration: the `ForwardHandler` ingests a `/fwd` for a local group that keeps its mail for pickup on arrival, on a relaying and a non-relaying host alike (a non-relaying host used to store it and rely on the loopback poll), and stores one copy unless it is the group's own traffic. The `MailboxPoller` of a runtime that owns the mailbox store never polls one of its own habitats for such a group; the group's remote members still poll the stored copy there. A local single-sig habitat whose mailbox is this host is still polled over loopback, its only local delivery of stored mail, and a runtime without the mailbox store still polls a local endpoint like any client.
