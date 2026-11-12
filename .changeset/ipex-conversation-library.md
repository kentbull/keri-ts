---
"keri-ts": minor
---

Add `sendIpexApply`, `sendIpexOffer`, `sendIpexAgree`, `sendIpexSpurn`, `ipexExchangeStatus` and `waitForIpexExchange` to `keri-ts/runtime`. They own the single-signature legacy IPEX conversation, prior-message validation, signing, local acceptance and delivery, so a library host such as a browser wallet need not reimplement what `tufa ipex apply`, `offer`, `agree` and `spurn` do. The CLI commands now call them with unchanged behavior; group controllers keep the existing CLI path.
