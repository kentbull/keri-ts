---
"keri-ts": minor
---

Add `sendIpexGrant`, `sendIpexAdmit`, `settleGrantCredential` and `requireAdmittableGrant` to `keri-ts/runtime`. They own the single-signature legacy IPEX credential grant, the holder's admit (the consent call for a stored grant) and saving the granted credential, so a library host such as a browser wallet need not reimplement what `tufa ipex grant` and `admit` do. Pair them with `ipexExchangeStatus` and `waitForIpexExchange(..., { until: "credential-saved" })`. The CLI commands now call them with unchanged behavior; group controllers keep the existing CLI path.
