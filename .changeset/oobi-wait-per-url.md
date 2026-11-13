---
"keri-ts": minor
"@keri-ts/tufa": minor
"@keri-ts/hosting": minor
---

`tufa oobi resolve`, `tufa dkr resolve` and the hosted DID resolver wait on the OOBI they were asked for (`waitForOobi` / `oobiStatus`) instead of on every pending runtime job. Unrelated pending group proposals, delegation escrows or queries no longer make an OOBI resolution time out. A timeout now reads `OOBI <url> did not resolve within <ms>ms.`
