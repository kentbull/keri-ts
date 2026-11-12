---
"keri-ts": minor
"@keri-ts/tufa": patch
---

Add runtime-owned single-signature IPEX Unblind to `keri-ts/runtime`. `requestUnblind` (the disclosee's consent) and `approveUnblind` (the discloser's consent to release proofs) are the only steps that sign. `UnblindingOperations.processOnce` then resends the unchanged query each second, delivers the reply, finishes the pending or live Grant and ends the operation at the Grant's original deadline; a restarted process reads `interrupted` and sends nothing. `unblindingStatus` is a pure read, `waitForUnblinding` only observes, and completion creates no Admit. `tufa ipex unblind --grant` for an individual identifier calls the library with unchanged flags, output and error text; group identifiers keep the existing CLI loop.
