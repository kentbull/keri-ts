---
"keri-ts": minor
---

Add `telEventStatus`, `issuedCredentialStatus`, `waitForTelEvent` and `waitForIssuedCredential` for v1 TEL publication, and `respondToChallenge`, `challengeStatus` and `waitForChallengeResponse` for challenge responses, to `keri-ts/runtime`. The waits only observe and return a timed-out value instead of throwing; the status reads derive from durable TEL publication tables and stored exchange messages. `tufa vc registry incept`, `vc create`, `vc revoke` and `tufa challenge respond` and `verify` now call them with unchanged behavior. `observeUntil` gains an optional `pollMs`.
