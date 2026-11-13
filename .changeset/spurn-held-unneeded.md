---
"keri-ts": patch
"@keri-ts/wallet": patch
---

A discloser's Unblind no longer drops a verifier's query as invalid when the issuer's KEL here has not reached the event anchoring a registry update: the query is held in `heldu`, the issuer's KEL is asked for through the ordinary query cue, and the query is answered when the event arrives (at the Grant deadline an unanswered one ends with a reason naming the missing anchor). A discloser whose presentation closed before it was asked ends its Unblind with the new non-failure state `unneeded` (`answerUnblind` returns at once with it). The refusal to Spurn a Grant that answers an Apply or Agree is kept, because KERIpy forbids it in both construction and verification, and now says what to do instead; the wallet library guide is corrected accordingly.

The wallet's group `credentials.unblind` now reads and waits as the group's actual party (a discloser no longer reads as a requester), and a discloser with nothing begun reads `interrupted` instead of throwing, so its `answerUnblind` starts.
