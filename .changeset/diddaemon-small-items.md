---
"keri-ts": patch
"@keri-ts/wallet": patch
---

A receipt for a group this runtime is a member of, or for a controller with no end role to send to, is no longer attempted (and logged as "No end roles for ..." on every event); the responder decides there is nothing to send. `settleProposedRotation` takes a named `ProposedRotation` (route, event, smids, rmids) instead of a whole `GroupEventResult`. The live, ended and settled operation tables of the issuance and Unblind owners are private; read them through `liveOf`, `endedOf` and `settledOf`. `pendingApplies` and the wallet's `credentials.applies` can list answered Applies too (`includeAnswered`; each entry has a `state` and the `answer` that closed it), and `agreeFor` / `credentials.agreeFor` read the Agree that answers an Offer.
