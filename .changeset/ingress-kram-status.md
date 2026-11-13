---
"@keri-ts/hosting": patch
---

Generic CESR ingress answers 422 with `KRAM refused message: <reason>` when the final non-query frame is dropped for
`timeliness`, `lifetime` or `unknownThread`, so a sender learns its message was late. Those reasons are decided only
after a signature or anchored seal verified; replay, authentication, missing, pending and timestamp outcomes still
answer 204. KERIpy always answers 204 here.
