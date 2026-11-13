---
"keri-ts": patch
"@keri-ts/hosting": patch
"@keri-ts/wallet": patch
---

Two fixes for a custodial host that keeps many identifiers in one Habery.

A signer the host releases (`Manager.release()`) no longer ends a running runtime. The mailbox poll for an identifier whose key is not held, and any other background loop that needs one, hit `Missing prikey in db for pubkey=...` and the runtime task failed, as did restarting while the signer was released. The error is now a typed `SignerNotHeldError` (same message, with the public key). The mailbox poller ends such a poll as a new `unsignable` outcome and waits; every runtime loop (queries, Poster, cues, escrows, OOBI, authentication, signals, delegation, Counselor, KEL publisher, operation owners) restarts after one. Each waiting loop is listed in `runtime.signerConditions` (`SignerCondition`: loop, missing public key, since) and the wallet's `health()` reports `signer-unavailable` with that list. `Manager.hold()` now notifies `Manager.onHold` listeners, and the runtime uses it to resume the waiting loops at once.

Several local identifiers may now advertise one ingress URL. A POST to the shared path used to answer 409 `Ambiguous hosted endpoint path` and a custodial host needed the `hostedPrefixes: []` policy to work. The handler now picks among the identifiers sharing the longest matching path by the request's `CESR-DESTINATION` (`resolveHostedEndpointPath` takes it as an optional argument); a request with no destination, or one naming none of them, still answers 409. Per-identifier paths are unchanged.
