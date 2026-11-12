---
"keri-ts": minor
"@keri-ts/tufa": patch
---

Add the holder side of runtime-owned issuance to `keri-ts/runtime`: `approveIssuanceExchange` is the holder's consent to the DH exchange, after which `IssuanceOperations.processOnce` answers the issuer's query, waits for its registry update and finishes the Grant, leaving the status at `awaitingAdmitConsent`. `admitIssuance` is the separate Admit consent: it signs and accepts the Admit locally and returns before delivery, so an embedder can record its own inventory first, and `deliverIssuanceAdmit` delivers it. `IssuanceDelivery.deliver` now returns the destinations reached. `waitForIssuance` accepts an `until` predicate. `tufa ipex --issue` for a recipient and `tufa ipex admit --acdc-v2` call the library with unchanged flags, output and wire behaviour.
