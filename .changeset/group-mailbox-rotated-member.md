---
"keri-ts": patch
---

A keri-ts mailbox host serves a group's mailbox to a member that rotated its own identifier ahead of the group. Besides meeting its own current threshold, the member must prove it controlled one of the group's current keys: either the poll is signed by a key in both the member's and the group's current key lists, or the host holds a verifying signature by a group-current key on an establishment event in the member's KEL. Listing a group key in a key list is still not enough, so an identifier that names a group key without signing with it is refused, before and after it rotates.
