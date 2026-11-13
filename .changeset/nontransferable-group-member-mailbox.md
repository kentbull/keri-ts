---
"keri-ts": patch
---

A non-transferable member of a group can now read its group's mailbox on a keri-ts mailbox host. Its poll carries a cigar (a non-indexed signature) and no source seal, and `authenticatesMailboxQuery` required a transferable requester, so every such poll answered 403 `Query requester is not authorized`. The host now verifies the cigar with the key in it and requires that key to be in the group's current key list: the key is the member's whole identifier, so the signature is the proof of control and the host needs no KEL for the member beyond the group's own. A signature by another key under the member's prefix, a key outside the list and a member whose key has left the list are still refused.
