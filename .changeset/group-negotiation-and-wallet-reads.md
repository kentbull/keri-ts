---
"keri-ts": patch
"@keri-ts/wallet": patch
---

A group sends an Apply, Offer, Agree or Spurn through `proposeGroupNegotiation` (named `GroupNegotiationInput`), the same consent path as `proposeGroupPresentation` and `proposeGroupAdmit`; an exchange that requires anchoring is refused for a group. The wallet's group `credentials.present` now honours `verb` for all five and no longer substitutes a Grant for an Offer. `pendingApplies` lists the accepted, unanswered Applies addressed to a local identifier, and the wallet exposes it as `credentials.applies` beside `credentials.pinSchema`, which keeps schema bytes it was handed. The runtime already creates a group identifier's DH owner when its first message arrives, so no `ipex.dhke(group)` call is needed first; `group-admit.test.ts` no longer makes one. A group Grant that answers an Apply is pinned in `erpy` like any answer; the test covers it.
