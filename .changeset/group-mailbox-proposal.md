---
"keri-ts": minor
---

Add `proposeGroupMailbox` and `completeGroupMailbox` to `keri-ts/runtime`. A group proposes its mailbox authorization (`/end/role/add`) to the other members, who approve it with `approveGroupProposal`; `completeGroupMailbox` then posts the accepted reply to the mailbox provider and refuses with the same message while the role is not yet accepted. `tufa mailbox add --multisig-mode propose|complete` calls them; its flags, output and errors are unchanged. The CLI-held propose/complete branches are removed rather than kept as wrappers; backward compatibility with 2.1.0 is not a goal for 2.2.0.
