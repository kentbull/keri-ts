---
"keri-ts": patch
"@keri-ts/wallet": patch
---

Rejoin a group after a lost store. `rejoinGroup(deps, { oobi, group, member, alias, timeoutMs })` resolves the
group's OOBI, waits for its accepted key state and records the group with `joinGroupHab`, reading the signing and
rotation members from that accepted state only. Remote outcomes are values: `joined`, `not-member`, `oobi-failed`
and `timed-out` (with what it was still waiting for); only `joined` writes. A record already naming the member is
returned as `joined` without I/O; one naming another member is refused in favour of `replaceGroupMember`. The web
wallet exposes it as `groups.rejoin(options)`. Credentials, registry state and exchanges are not restored by it.
