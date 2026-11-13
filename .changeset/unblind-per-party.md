---
"keri-ts": patch
"@keri-ts/wallet": patch
---

One Habery can now hold both the discloser and the disclosee of a presentation and run both sides of its Unblind: live and settled operations are keyed by the Grant and the party (`unblindingKey`, `liveOf`, `settledOf`), `unblindingStatus`, `waitForUnblinding` and `abandonUnblinding` take an optional `UnblindingParty`, and a recipient held in the same Habery takes the bytes in process (new optional `reactor` dependency). The DH and Unblind query receiver hands a query between two local parties to both. `requestUnblind` after the verifier has answered the presentation throws the typed `PresentationClosedError` (an Admit or Spurn ends the discloser's authority; request the Unblind first). A refusal for an update that cannot be opened now says why (a random blinder cannot be derived from the registry root). A rotation proposal is taken on receipt only when it also names the group's current rotation members (`rmids`), not only its signing members.
