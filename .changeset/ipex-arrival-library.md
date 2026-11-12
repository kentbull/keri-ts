---
"keri-ts": minor
---

Add library poll-and-settle for credential IPEX arrivals to `keri-ts/runtime`: `settleStoredGrants` replays stored grants, `ipexBaseline` and `ipexArrivalStatus` read what arrived from durable state, and `waitForIpexArrival` observes until new state settles or a deadline returns a timed-out `WaitResult`. A wallet whose runtime already polls uses status and wait only; `tufa ipex poll` keeps running its own workers and mailbox poller around the same wait, with unchanged output and errors.
