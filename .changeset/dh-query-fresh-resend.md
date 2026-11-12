---
"keri-ts": patch
---

The issuance owner now resends its DH query freshly signed each second instead of repeating the same bytes until the sender's own KRAM window had passed. A peer's KRAM caches every query it accepts and drops an identical resend as a replay, and the DH owner holds a query that arrives before the recipient consents in memory only; so a recipient that took the first query and lost it (a `tufa ipex poll` process that exited, or a retained query older than its window) never saw another one, and the issuer waited until its timeout. This stranded a browser-issued DH credential in some runs of the browser wallet lane against a Tufa counterparty. The sender's window was no guide: a wallet's lag windows are 24 hours, a Tufa peer's 60 seconds. Each resend keeps the Grant, the transaction and the ephemeral keys, and changes only the query's date, SAID and signatures; with the Keeper locked the last query is sent again unchanged.
