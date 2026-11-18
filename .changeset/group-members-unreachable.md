---
"keri-ts": patch
---

Add `unreachableGroupMembers` to `keri-ts/runtime`: the remote members of a group that a local member has no accepted
end role to reach, read the way delivery would. Group messages go to every other member, so a caller can now tell
before it proposes which member still lacks a route, for example an edge that has not named its agent its mailbox.
`proposeGroupInception` uses it for its existing refusal; no proposer's behavior changes.
