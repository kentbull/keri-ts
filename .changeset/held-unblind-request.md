---
"keri-ts": minor
---

An Unblind request a discloser has accepted and owes a reply to is persisted (`Baser.heldu`, keyed by discloser and exchange id), so a reopened runtime answers it with no resend: KRAM records the request as seen and drops an identical resend as a replay, and a group requester cannot re-date its request. The discloser's operation is a cache; `Unblind.awaitingReply` takes up the persisted requests once, and `IpexAuxiliaries.unblindOwners` makes the owner for an identifier that owes one. The row is removed when the operation ends. A drain-only command such as `tufa ipex poll` taking a request is therefore harmless, and no `ipexQueries` runtime option exists.
